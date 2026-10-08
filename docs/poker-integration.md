# Signed-in Ember Den: integration review

This change connects the existing ten-table, nine-seat poker floor to Ooga's
GitHub login and room voice. It adds browser recovery to the existing encrypted
deck protocol and a redesigned lobby, table view and action dock. The shuffle
protocol is unchanged. Banana chips remain free, disposable and unredeemable.
See [poker-interface.md](poker-interface.md) for the interface review.

## Deployment boundary

Live poker is **disabled until both settings below are configured**. The Worker
now owns `/poker/*`; an unconfigured service returns JSON with status 503. Local
practice and the Ember Den's appearance remain available.

1. Run `server/poker/server.mjs` from the same reviewed commit as the site, as a
   **single Node 22+ process** behind HTTPS. The service keeps tables in memory;
   do not round-robin requests across independent processes.
2. Generate a 32-byte random secret, encoded as 64 lowercase hex characters.
   Set it as `POKER_SERVICE_TOKEN` in the Node host's secret manager and with
   `wrangler secret put POKER_SERVICE_TOKEN --config wrangler.staging.jsonc`
   for the site Worker. Never put the value in git or a browser setting.
3. Set the Node process's `POKER_ORIGIN` to the exact site's `SITE_ORIGIN`.
   Configure `POKER_HOST` and `POKER_PORT` for the host; non-loopback listening
   requires both `POKER_ORIGIN` and `POKER_SERVICE_TOKEN`.
4. Set the Worker's `POKER_SERVICE_URL` variable to the service's HTTPS origin,
   with no credentials, path, query, fragment or redirect. It must differ from
   the site's origin. Keep staging and production services/secrets separate.
5. Verify on staging before considering the equivalent production settings.
   This PR neither supplies hosting/secrets nor deploys anything.

Only five routes are proxied: the private worker script, health, session, state
and command. Every request requires Ooga's current session and same-origin
metadata. The Worker builds identity headers from that session; browser identity
headers and cookies never reach the poker host. The service requires the shared
secret and exact site Origin, and binds each poker token/key to an account.
The public display name comes from the signed-in account. One account cannot
acquire a second active signing identity or concurrently sit at two tables.
After leaving another browser, allow 90 seconds for that connection to expire
before using a new key. This limits account reuse, not multiple-account collusion.

Requests have bounded bodies, account rate limits and upstream timeouts. The
gateway does not follow redirects or relay cookies/HTML from service errors.
Service instances have random identifiers: old tokens/commands cannot be used
against a freshly restarted service. Server restarts end old hands and reset
disposable balances; browser recovery is not durable server storage.

## Recovery behavior

When connecting to signed-in live play, the private worker acquires an exclusive
Web Lock for that account and origin. Another tab must close its poker connection
before taking over. IndexedDB stores an AES-GCM encrypted checkpoint with a
nonextractable browser CryptoKey. The account and protocol version are bound as
authenticated data; the encrypted contents include the service instance, table,
signing key, current hand key, verified public history and any pending command.
Anonymous localhost sessions remain ephemeral and do not write recovery data.

The identity is saved before registering it; a hand key is saved before its
public proof is sent. Every signed move is saved before transmission. If the
response disappears, the client resends those exact signed bytes, including the
same sequence and signature. The existing relay deduplicates the request. A new
move cannot replace an uncertain one. Storage errors stop play rather than
publishing a key or move that cannot be recovered.

On reload, choose **Join live tables** with the same account, origin,
browser profile and device. The worker imports the saved key, independently
replays the public record, checks the hand key against its published key, and
resumes the saved table. It never releases arbitrary card shares requested by
the relay. Verified completion/cancellation removes the private hand key from
the next checkpoint. Public receipts remain exportable without private keys.
**Leave seat** between hands, then **Forget recovery on this device** deletes that
account's local checkpoint. Clearing the site's browser storage also removes it.
Signing out stops the live worker; it does not delete recovery needed to sign
back in before a hand expires. Account deletion on the server does not remotely
erase browser storage; use Forget recovery first if that is desired.

Recovery still needs the other players online and must finish before the
existing 90-second contribution/turn deadline. Long absence, evicted public
history, cleared storage, unsupported IndexedDB/Web Locks, a different profile,
or a service restart can prevent recovery. A restart is explicitly reported and
old private hand state/pending moves are discarded. No seed, secret hand key or
owner's hidden card share is uploaded to the relay.

Encryption at rest is not protection against malicious same-origin JavaScript,
an unlocked compromised browser or a stolen browser profile. The CryptoKey is
stored beside the ciphertext so the browser can recover it. Keys are not
hardware-backed by this implementation. Browser eviction and process/power loss
can still lose a checkpoint; IndexedDB completion is not a backup guarantee.

## Table voice and spectators

Watching a table selects that table's voice channel for players and spectators.
**Walk the floor** selects the floor channel. Voice still uses Ooga's existing
opt-in microphone, mute controls, authenticated room and driven-avatar rules.
All avatars keep the `ember-den` visibility zone and can walk around each other;
voice selection does not split the visual scene. The room persists the channel
through hibernation, restores it after a socket reconnect, rechecks it on track
pulls, and clears it on departure. These are public conversations that spectators
can join; they are not confidential channels or an anti-collusion mechanism.
Walking preserves the seat and its normal turns. The lobby offers a return
control; leaving the seat is a separate action under Table options.

The existing room/presence limit is **32 players**, shared with the island. Ten
nine-seat table definitions do not establish capacity for 90 simultaneous people
plus spectators. Scaling that room and load-testing proof generation, recovery
replay and ten concurrent hands remain separate work.

## Review and validation

Per `AGENTS.md`, the default validation mode is **wait**: build and JavaScript
syntax checks only. No Node runtime tests, browser tests or visual probes were
run for this change. Regression coverage was added for the gateway, account/key
binding, simultaneous cross-table joins, key import, table voice/hibernation and
actual worker recovery after a lost accepted-command response. The interface
revision also adds a regression for action acknowledgments, reconnect blocking
and transient progress messages. The worker
recovery fixture uses a storage adapter; it does not validate browser IndexedDB
or Web Locks. Maintainers can request/run:

```sh
npm --prefix worker test
node test/run.mjs poker-protocol
npm test -- poker
```

Found / remaining staging play-tests: two distinct signed-in accounts completing
a hand; reload during key exchange, shuffling and betting; a lost response after
acceptance; second-tab refusal; account switching; expired login; blocked/full
storage; Forget recovery; timeout refunds; service restart; table/floor voice
with a walking spectator; scene exit/re-entry; keyboard and phone layouts in
the built page. Browser storage and voice behavior need those checks before
this draft becomes merge-ready. The cryptographic implementation remains
experimental, unaudited and nonconstant-time; this is not a fairness audit.
