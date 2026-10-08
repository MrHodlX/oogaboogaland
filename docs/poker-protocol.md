# Banana Poker: experimental encrypted-deck service

This is working source for an experimental mental-poker service and client,
not a cryptographic audit or production security certification. It extends the
existing ten-table floor; five cave themes, suited gorilla dealers, nine seats
per table and walkable spectator aisles remain. All chips are free, disposable
play points. No rake, purchase, transfer, redemption, wallet, Spark integration
or outside-settlement feature is included.

## Run the shared floor

Node 22 or later is required. No packages need installing.

```sh
npm run poker:serve
```

Open `http://127.0.0.1:8787/?scene=poker&pokerLive=1` in two separate tabs.
Enter the floor, choose a table name, select a table and take a seat in both tabs.
Any funded, seated player can press **Deal hand**. There are no live-mode bots.
Each tab is a distinct anonymous player with its own keys; two tabs on one
machine demonstrate functionality, not independent trust domains.

**Walk the floor** allows walking without disconnecting a seated player. Stay
connected after folding to help open community cards. Stand between hands before
exiting. Spectators receive no private hole cards. Seated avatars show occupancy;
the hosted Ooga floor also shares walking positions and table voice. The standalone Node demo does not provide Ooga login or voice.

Each required protocol contribution or betting turn has a 90-second deadline
from the last accepted table event. A repeated request does not reset it.
A timeout cancels the hand, refunds committed chips, and releases missing
contributors' seats. They have a 60-second start/join cooldown. Canceled public
records remain available during reconnect. No secret key is sent to the relay for recovery. Signed-in hosted play saves encrypted recovery on the same device and replays the public record after reconnecting; anonymous localhost sessions keep keys in memory and lose them on reload. Recovery must still finish before the deadline. Sessions and play-chip balances reset when the service restarts.

**Quick Play** remains local practice when disconnected. Its local shuffle has
no distributed fairness certificate. The standalone HTML opens practice mode;
shared play requires the service.

## Hosting and team integration

The service binds to loopback by default for the anonymous local demo. The
Cloudflare site has an optional authenticated same-origin gateway, enabled only
when a Node service URL and shared secret are configured. See
[poker-integration.md](poker-integration.md) for staging setup, account binding,
encrypted browser checkpoints, table voice, failure handling and remaining
validation. The Node process is still a single in-memory relay; service restarts
reset tables and balances. Static GitHub Pages alone cannot execute it.


## Protocol

The domain is `ooga-poker-switch-v1`. Each hand has a fresh nonce, attempt number,
table, fixed funded-player roster, dealer position and blinds. The starting
public table checkpoint and accepted signed commands form a SHA-256 hash chain.
Every participant acknowledges the same completed shuffle record before dealing.

1. **Hand keys.** Each client samples a fresh secret scalar `x_i` in the P-256
   prime-order group, publishes `X_i = x_i G`, and proves possession with a
   domain-separated Schnorr proof bound to the roster and session identity.
   Duplicate and identity keys are rejected. The aggregate `Y = sum X_i` must
   be nonidentity. Command-signing keys are separate from hand keys.
2. **Deck.** The distinct card messages are `(1G, 2G, ..., 52G)`, numbered as in
   `poker-rules.js`. A starting ElGamal ciphertext for `M` is `(G, M + Y)`.
   Its initial randomness is intentionally public; subsequent shuffles provide
   privacy.
3. **Uniform permutation.** Each participant uses Fisher-Yates with Web Crypto
   and rejection sampling. The sampled permutation is routed through a fixed
   recursive two-input switch network. Random independent switch settings would
   not yield a uniform permutation and are not used.
4. **Shuffle proofs.** Each switch independently re-encrypts its two outputs.
   An OR-of-AND Chaum-Pedersen proof establishes either straight or crossed
   pairing without revealing which. Both input messages are used exactly once;
   neither can be replaced or duplicated. Verification reconstructs the fixed
   wiring, including odd-size subnets, and rejects missing/extra switches. The
   final deck is derived from the verified switches.
5. **Agreement and dealing.** Every player signs the completed shuffle record
   root. Poker rules then assign fixed positions: two rounds of hole cards
   clockwise after the dealer, and one burn per street. The relay cannot select
   different values or reorder this deck without failing client verification.
6. **Private cards.** For ciphertext `(A, B)`, every participant except the
   hole-card owner publishes `D_i = x_i A` with a Chaum-Pedersen proof. The owner
   subtracts those shares and its own locally computed share from `B`. The
   owner's share remains private.
7. **Board and showdown.** Players release proved shares only for board cards
   authorized by the betting state. At showdown, only contenders release their
   missing hole-card shares. Folded owners never release theirs. Unused and burn
   cards are not opened.

For each switch branch, the two candidate ciphertext differences `(A_j, B_j)`
must satisfy `A_j = r_j G` and `B_j = r_j Y`. That branch uses one challenge `c`
and two responses `z_j`. Its commitments reconstruct as
`(z_j G - c A_j, z_j Y - c B_j)`. The two branch challenges sum modulo the group
order to the Fiat-Shamir challenge. The challenge hashes the domain, full
hand/shuffle context, switch index, aggregate key, inputs, outputs and all
reconstructed commitments. Both simulated and real branches use fresh
independent randomness. Challenges use SHA-512 reduced modulo the P-256 order.

Decryption proofs bind the hand, identity, exact position, ciphertext, hand key
and released share. Wire points use canonical uncompressed P-256 encodings
(or explicit identity where permitted), range/curve checked. Public keys,
final card first components and released shares must be nonidentity. Scalars
are canonical 32-byte lowercase hex below the group order.

Clients replay the signed public state machine in a worker. They derive share
allow-lists locally, never answering arbitrary server requests for secrets or
card openings. The relay runs the same public rules and proof checks. It sees
plaintext community/showdown cards only. Its state has no field for private
keys, shuffle permutations or private hole-card values.

## Verify a hand

At a live table open **Shuffle & hand verification**. **Verify hand** replays
the record; **Download hand record** exports public proof data as JSON. Check a
saved file using the file picker or independently using a locally reviewed copy:

```sh
npm run poker:verify -- path/to/banana-poker-hand.json
```

The CLI does not contact a service or execute JSON content. Exit 0 means a
completed record passed the implemented checks; exit 2 means a valid but
incomplete/canceled record; exit 1 means failure. Output includes its fingerprint,
shuffle contributors, public card count and payout. No whole-deck seed, private
decryption key or hidden owner share is exported. Public participation and
betting history are included; this is not an anonymous hand-history format.
Cancellation markers are relay assertions: replay reconstructs refunds but
cannot prove elapsed time or the claimed reason for a disconnection.

The initial checkpoint is the starting assumption for balances. The verifier
checks subsequent play and settlement, not an account balance before that
checkpoint. A success message is not an independent audit of this implementation.
Obtain the verifier from a trusted source instead of relying solely on the host's UI.

## Security limits

- Established ElGamal, Chaum-Pedersen, Schnorr and AND/OR constructions are combined
  in a new, unaudited implementation. Tests do not establish a formal security proof.
- Privacy assumes P-256 discrete-log/DDH hardness, correct Fiat-Shamir proofs in
  the random-oracle model, secure randomness, correct clients and protected keys.
  Uniformity requires at least one honest, unpredictable shuffle. Proofs establish
  valid permutations, not the quality of a malicious participant's RNG.
- BigInt arithmetic and lookups are not constant time. Local timing/cache side
  channels require further work. Garbage collection cannot guarantee erasure
  of previous scalar copies.
- A compromised browser, altered delivered JavaScript or colluding participants
  defeats the corresponding assumptions. Players can share cards or control
  multiple seats. This is not anti-collusion or Sybil-resistance software.
- Players/host can abort or censor. Refunds and records do not prevent selective
  abort bias across completed hands. Cooldowns provide friction, not a proof.
- N-of-N decryption trades availability for privacy. There is no all-keys recovery,
  forced reveal of folded cards or fallback server deck.
- Review point/scalar validation, encoding, OR-proof composition, roster and
  acknowledgment binding, key lifecycle, replay resistance, worker delivery and
  HTTP resource limits before deployment. Load-test ten simultaneous full tables
  on actual target devices. The shared room currently caps presence at 32 players. Ten nine-seat tables have not been load-tested for 90 live players plus spectators.

## Source and validation

| File | Responsibility |
| --- | --- |
| `src/js/poker-crypto.js` | Group math, signatures, switch routing and shuffle/share proofs. |
| `src/js/poker-match.js` | Public state machine, signed record and replay. |
| `src/js/poker-rules.js` | Local rules and sealed-position rules with exact refunds. |
| `src/js/poker-recovery.js` | Account-scoped encrypted checkpoints and exclusive browser ownership. |
| `worker/src/poker.js` | Authenticated same-origin gateway to the optional service. |
| `src/js/poker-worker.js` | Private keys, transport, verification and authorized shares. |
| `src/js/poker-live.js` | Main-thread worker bridge and views. |
| `server/poker/server.mjs` | Service, long polling, queues, deadlines and limits. |
| `server/poker/verify.mjs` | Independent public-record verifier. |

Focused Node checks are in the existing `test/run.mjs`:

```sh
node test/run.mjs poker-protocol
```

They compare P-256 math with native Node/OpenSSL, test network routing, play a
nine-party encrypted hand with side pots and a fold, reject tampered proofs
and premature private shares, replay the public record, run actual worker code
over HTTP, and check timeout/replay/origin/identity boundaries.

Historical validation of the original protocol reported 124/124 combined checks
and 5/5 focused checks. Those results predate the account/recovery integration
and are not validation of this change. See its integration notes for current
validation and deferred play-tests.

The existing browser-test STOP remains in force. No Chrome test was retried.
Node worker/HTTP checks are not a browser UI test. See the delivery manifest for
actual results and the preserved failure ledger.

## Primary references

- Historical Fair.Poker: https://github.com/fairpoker/mental-poker
- SEC 2, P-256: https://www.secg.org/sec2-v2.pdf
- Schnorr, Chaum-Pedersen and AND/OR proofs, Johns Hopkins:
  https://www.cs.jhu.edu/~susan/600.641/scribes/lecture10.pdf
- Switch-network routing and two-coloring, MIT:
  https://web.mit.edu/neboat/Public/6.042/communicationnetworks.pdf

Fair.Poker's historical code was studied, not copied. This implementation and
its proof composition require their own independent review.
