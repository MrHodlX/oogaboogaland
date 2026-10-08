# The Ember Den poker floor

Implemented against OogaBoogaX/oogaboogaland `rock`, inspected source snapshot
`e1c69776153a05794b3fc6da6af9b584a7820ebf`.

## Status

This build includes local practice and an **experimental encrypted-deck
multiplayer service**, private dealing, signed public hand records and an
independent verifier. It is not an audited or production-certified release.
The existing ten-table floor and five cave themes remain. Read
[poker-protocol.md](poker-protocol.md) for the protocol, service commands,
security assumptions and hosting requirements.

The current interface revision adds a filtered table browser, a clearer betting
dock and live connection feedback. See [poker-interface.md](poker-interface.md)
for the interaction changes and remaining play-tests, and
[poker-integration.md](poker-integration.md) for signed-in deployment and recovery.

Browser playthrough, fallback rendering, touch layout, audio, automatic hand
progression, the theme picker and visual appearance, scene round trips, and the
changed hub entry remain unverified:
the available Chromium lost its DevTools connection on both previous attempts
before assertions could run. The repository's consecutive-failure rule requires
stopping; the handoff includes the unchanged failure ledger. No browser test was
retried for this revision. This document does not authorize another retry.

## Play

For shared play, run `npm run poker:serve` and open
`http://127.0.0.1:8787/?scene=poker&pokerLive=1` in separate tabs. Take seats and
press **Deal hand**. Every participant contributes an encrypted shuffle.
Verification runs in a background worker. A missing contribution or action
cancels the hand after 90 seconds without progress, refunds committed chips,
and releases missing players' seats. Stay connected after folding; stand
between hands before exiting. No keys are sent to the server for recovery.
There are no live-mode bots or automatic deals.

The following controls describe local practice:

Build with `npm run build`, then open `oogaboogaland.html`, or run
`npm run serve` and open `http://127.0.0.1:8080/?scene=poker`.
For a direct file preview, append `?scene=poker` to the file URL.

In the island, possess an Ooga and enter ₿IFRÖST. Walk through The Ember Den's
window beside the DSB Land window: its arch glows in the room's felt colour and
it shows a picture of the room. The same Ooga appears directly in the room,
without a title card or transition animation. The return mirror brings them
back to ₿IFRÖST, in front of that window.

**Play a practice hand** takes a free seat, adds enough computer opponents for four
players and deals. Or choose any of the ten lobby table cards, take a specific seat,
add three bots at a time, and deal when ready. You can also run a bots-only table
while spectating. Every table has nine player seats plus a suited gorilla
dealer. Two funded seats suffice; there is no table owner or privileged host.

Choosing a table opens a focused oval-table view over the room. Your seat stays
at the bottom. Player stacks, round bets, dealer and blind markers, folds,
all-ins and the acting player appear around the rail. Community cards and the
pot sit in the center; your private cards and actions are in the lower dock.
Public showdown cards appear at the eligible players' seats. A winner banner
shows chips collected, including returned contributions, rather than claiming
that the full award is profit.

Use Fold, Check/Call, or Bet/Raise. The numeric field and slider set a **total for
the current betting round**. Min, half-pot, three-quarter-pot, pot and all-in
presets only select an amount: they never submit a bet. A pot raise includes the
call before sizing the raise. The rules still enforce minimums, all-in caps and
raise rights. Submitted UI actions carry the displayed table version so a stale
click is rejected. The sizing helper also shows the additional chips and your
remaining stack. Live actions stay disabled until their own request is
acknowledged in a refreshed, verified state. There is no time limit on the
human's turn in practice.

Auto deal defaults on and waits at least five seconds after settlement. It
refills busted computer seats for free between hands. A busted human stops the
loop and chooses a free refill explicitly. Auto deal can be disabled per table;
Pause practice pauses all local tables. Optional synthesized deal/turn/win sounds
start only after opting in, with no audio downloads. The history keeps the last
twelve completed public hand summaries per table during this floor visit; it
never archives a player's private or folded cards. Card motion respects the
reduced-motion preference.

WASD/sticks move the spectator; drag/look controls use the shared pilot. The
central aisle and passages between table rows remain walkable. **Walk the floor**
closes the playing view. Fold the lobby to see more of the room. All physical
tabletop hole cards are identical backs; walking behind a seat reveals nothing.
A spectator can watch the focused view, return to walking, and select another
table. Taking a second seat requires leaving the first.

**Walk the floor** moves a seated visitor into the aisle while keeping their
seat and normal turns. The lobby's **Your seat** button returns to the table;
it shows when it is time to act. Walking does not check or fold for you.
**Leave seat** is a separate control under Table options. During a practice
hand it checks when free and folds when facing a bet, then releases the seat
after settlement. Already all-in chips remain eligible. Live seats can leave
only between hands. Escape closes the focused view; a second Escape while
seated requests leaving the seat. Unseated visitors can return through the
mirror to ₿IFRÖST. Leaving the scene pauses its local tables; returning resumes
them. Reloading resets practice chips.

## Visual revision: Gatsby meets Ooga Booga Land

The underground room now uses ivory limestone, emerald upholstery, brass
sunburst wall panels and geometric floor inlays. Three chandelier clusters are
built with the world's existing hanging lantern and cable kit. Hanging vines
keep the tropical island character. Warmer, brighter ambient light lifts the
room; the first ten point lights still serve the ten tables on the low tier.
Decoration sits overhead or against the walls, outside the spectator aisles.

Cards now have rounded paper edges, proper suit shapes, corner ranks at both
ends, traditional numbered pip layouts, original double-ended Jack/Queen/King
portraits and identical navy-and-gold banana backs. `poker-cards.js` supplies
one cached vector design to both the tabletop meshes and inline HUD SVGs.
There are no card textures, remote fonts, external images or extra requests.
Only public community cards use face-up meshes; private tabletop cards remain
backs. The hand display has larger cards and accessible full card names.

The original card artwork and Gatsby room remain in this poker-interface
revision. Its appearance still needs local play-testing under the existing
browser-test stop instruction below.

## Cave themes

Choose **Cave theme** under the lobby's **Room style & connection options** or
the table's **Room style** section. The lobby
also offers five visual swatches. A theme changes the whole local room's stone,
chairs, felt, architectural details and lighting together with the poker HUD.
The original Banana Club remains the default.

| Theme | Room character |
| --- | --- |
| Banana Club | Ivory limestone, emerald felt, brass fanlights and chandeliers. |
| Crystal Grotto | Blue stone, cyan/amethyst wall crystals, teal lanterns and lagoon felt. |
| Ember Cavern | Basalt colors, glowing amber fissures, copper trim and warm red felt. |
| Jungle Ruins | Mossy limestone bands, hanging vines, rune stones and fern-green felt. |
| Moonstone Hollow | Pale mineral bands, silver trim, cool lanterns and violet felt. |

₿IFRÖST's window into the room follows the theme last chosen here: its arch
glows in the theme's felt, lifted to glow, and its picture shows the room in
that theme.

These decorate the underground floor reached through ₿IFRÖST's Ember Den window;
no repository cave slot is claimed. The cave finishes follow the mine's
banded-rock architecture, with lanterns, vines and rune stones from the shared
`BL.dressing` kit. Glowing fissures are visual decoration, not walking hazards.
New wall formations sit beyond the existing spectator movement boundary, and
the central and cross aisles retain the same footprint.

The preference is saved under `ooga-poker-theme` in localStorage. Unknown values
fall back to Banana Club; blocked storage still permits changing the current
visit's theme. This is a cosmetic preference, not a chip balance or hand save.
The scene swaps cached scenery and furniture geometry in place: it does not
re-create table instances, seats, dealers, card nodes, input targets or betting
controls, or reset the bot timer. A theme may be selected during a hand without
submitting or resizing a bet. Card faces and identical card backs stay consistent
across themes. No additional images, fonts, dependencies or network calls are
used.

`poker-themes.js` contains the five palettes and validated preference lookup.
Scenery is built lazily and cached for at most those five themes. Retired scenery
nodes leave the graph for the renderer's existing housekeeping; no new per-frame
geometry, particles or allocations were introduced by theme switching.

## Chips and rules

- No-limit Texas Hold'em; blinds 5/10, free starting stack 1,000.
- Best five of seven cards, including ace-low straights; heads-up blind/action order.
- Integer chip accounting, side pots, uncalled excess refunds, ties and odd chips
  clockwise from the dealer button. Zero rake.
- The Raise input is the **total contribution for this betting round**, not the
  additional amount. A short raise is allowed only when all in. A short all-in
  does not reopen a player's raise rights unless cumulative action faced reaches
  a full raise. No betting into an uncontested dry side pot.
- Refills are free between hands when below 1,000. Auto deal refills busted bots;
  a busted human must choose a refill. Play a practice hand refills the visitor for free.
- These bananas are disposable play points, separate from the world's donation
  bananas. No purchase, cash value, player transfers, prizes or redemption.
- No Spark, wallet, payment processing, cash conversion, or outside-settlement
  feature was added. This is a product scope statement, not a legal assessment.

## Local practice shuffle and privacy

Each hand uses a fresh Fisher-Yates shuffle driven by `crypto.getRandomValues`.
Bounded integers reject the modulo-bias tail. If secure randomness is absent,
dealing fails before balances or the current hand are mutated. There is no
fallback to `Math.random`, no production seed override and no published deck.
Random cosmetic movement in existing avatar code is unrelated to cards.

The local module keeps its deck inside a closure and returns copied, filtered
snapshots. Bots use only their own filtered view. This reduces accidental
disclosure; it is **not a security boundary against the owner of the browser**.
The browser can replace code, ask for another viewer's snapshot, or change its
local state. Do not call this demo cheat-proof or provably fair. Simulation and
statistical tests cannot prove a particular hand was honestly shuffled.

## Local and shared table boundaries

`BL.pokerRules.create()` provides the local table implementation:

| Method | Meaning |
| --- | --- |
| `join(id, name, bot, seatIndex)` | Take a free seat between hands; default index selects the first free seat. |
| `leave(id)` | Stand between hands; rejects mid-hand removal. |
| `refill(id)` | Free refill below 1,000 between hands. |
| `start()` | Deal with at least two funded seats; reject overlapping hands. |
| `act(id, action, amount)` | `fold`, `check`, `call`, or `raise` to a total integer amount. |
| `snapshot(viewerId)` | Copied public state plus that viewer's cards and legal action. |
| `version`, `playing` | Change counter and active-hand status. |

Local practice owns ten instances under `world.poker`. Shared mode connects to
`server/poker/server.mjs` and uses `createSealed()` on the server and each client
verifier. Rules deal encrypted-deck positions. Plaintext enters the server only
through authorized community/showdown openings. Each browser decrypts its own
hole cards locally. Clients cannot select a remote snapshot viewer ID.

The service includes seat reservations, signed commands, per-table queues,
version/idempotency checks, deadlines, refunds and basic request limits.
The integration branch adds account binding, encrypted browser recovery, shared
walking presence and table/floor voice; see [poker-integration.md](poker-integration.md).
Durable server storage, deployment, production hardening and capacity beyond
the existing 32-person shared room remain separate work.

The new protocol uses proofs without publishing whole-deck seeds or private
keys. Folded-card privacy depends on the assumptions in the protocol document.
Independent review remains required. Refunds do not eliminate selective-abort
bias or collusion.

## Files and validation handoff

Floor modules: `poker-rules.js`, `poker-cards.js`, `poker-themes.js`,
`poker-models.js`, `poker-hud.js`, `scene-poker.js`. Shared-play additions:
`poker-crypto.js`, `poker-match.js`, `poker-worker.js`, `poker-live.js` and
`server/poker/`. Integration edits: `src/index.html`, `src/style.css`,
`src/js/scene-hub.js`, `package.json`.
Checks live in the existing `test/run.mjs`; no test framework or dependency was
added. The repository's browser driver and shared renderers were not modified.

The combined run passed **124/124 Node checks**: the 119 existing checks and
five protocol checks, including a nine-party encrypted hand, side pots,
folded-card privacy, native P-256 interoperability, tampering/replay rejection,
independent record replay and real worker clients over HTTP. The final focused
protocol run also passed **5/5 checks** after disconnect cleanup, including
release of abandoned seats and retention of cancellation/refund records. The build and syntax checks also passed. Existing checks cover payouts, odd
chips, secure-entropy failure, rejection sampling, turn/seat validation, snapshot
isolation, heads-up order, 300 nine-player settlements, spectator collision
lanes, pot presets including the call, short-all-in caps, closed raise rights,
public blind metadata and theme switching. The theme contract switches through
all five looks twice, checking that table pick targets, chairs, dealers and dealt
card nodes remain intact and that the scene returns to its original node count.
This is not a browser rendering or appearance test. Browser selectors were
updated for the lobby and focused view in the previous revision; those browser
sessions remain unrun.

Blocked: the three registered poker browser sessions (`poker floor and play`,
`poker canvas2d`, `poker phone`) each have streak 2 with
`DevTools socket closed: Chrome is gone`. No browser assertions completed.
The hub browser suite has not been run. Screenshots/performance/120 simultaneous
human players have not been validated. A maintainer should play-test the floor,
phone controls, and ₿IFRÖST mirror round trip before accepting or publishing.

For integration, apply the supplied patch to the pinned base or reconcile the
changed source/document/test files onto the latest `rock`. Do not overwrite
new upstream work with the whole snapshot. The source snapshot is supplied for
reproducibility, not as permission to revert upstream changes. The built HTML is
for local preview; the existing CI rebuilds the deploy artifact after merge.

## Interaction references

The original UI uses established table conventions, not copied branding or
site assets. Reference documentation consulted for this revision:

- PokerStars table appearance: https://www.pokerstars.com/help/articles/table-appearance-feature/
- PokerStars bet slider: https://www.pokerstars.com/is/help/articles/bet-slider-options/11042/?ooac=1
- GGPoker mobile controls: https://legal.ggpoker.com/blog/all-about-the-ggpoker-mobile-app/

No real-money features, promotions or cashier flows were carried into this game.
