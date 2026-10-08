# Ember Den interface revision

The floor needs a clear path from walking in to playing a hand. The previous
table view mixed betting, room preferences and protocol detail, and its Walk
control also relinquished a practice seat. This revision separates those jobs
while retaining the ten stone tables, nine seats per table, suited gorillas,
five cave themes and free banana chips.

## Player flow

- **Enter:** choose Play a practice hand for four-player practice, or Join live
  tables for the configured service. Each mode is labeled throughout the view.
- **Find a table:** ten compact cards show occupancy and hand status. All
  tables, Open seats and In play filters help find a seat or a hand to watch.
  Open seats means a seat can be taken between hands, not a mid-hand waitlist.
- **Follow a hand:** the oval table emphasizes the board, pot, acting player,
  stacks and round bets. Private cards sit beside the turn prompt. A separate
  information rail holds public actions, table options and expandable details.
- **Act:** Fold, Check/Call and Bet/Raise retain their positions. Presets choose
  a size without sending it. The input is a total for the round; helper text
  explains the additional chips and remaining stack. Calls and maximum raises
  explicitly identify all-ins. Refills say they are free.
- **Walk:** Walk the floor keeps the seat, exposes movement controls and moves
  the avatar into an aisle. The lobby shows a return button and turn status.
  Return restores the seated view. Turn sounds, if enabled, work while walking.
- **Leave:** Table options contains a separate Leave seat control. Practice
  can check/fold remaining turns and leave after settlement; live play requires
  waiting between hands. Walking never silently submits a poker action.

The gold, emerald and ivory interface uses the room's existing theme variables
and original vector cards. Smaller viewports stack the information rail below
the hand, with a scrollable panel and compact private-card layout. Buttons keep
visible keyboard focus; card motion respects reduced-motion preferences. Theme,
history, verification and rules remain available without filling the action
area. This is source-level implementation, not a claim of completed visual QA.

## Live feedback and request handling

The interface distinguishes initial connection, connected play, sending a move,
automatic reconnection and a stopped connection. It shows the server's table
deadline and offers Reconnect after a stopped worker. Reconnecting uses the
existing account-bound browser checkpoint; it cannot extend a deadline or
recover cleared keys. Leaving the scene aborts pending connection work so a
late response cannot attach a worker to a later scene visit.

Each UI action gets a local request number. Controls lock immediately, and the
worker includes an acknowledgment in a subsequent verified state only after
that action finishes. An older state response cannot unlock another bet. An
uncertain signed command remains pending through the existing exact-byte retry
and recovery path. Network failure blocks new actions until a refreshed state
arrives; a stopped worker cannot be revived by a late state message. Request
numbers are UI bookkeeping, not a new signature, proof or server authorization.

Shuffle/reconnect progress clears when verified state arrives. Action errors
and explicit verification results survive unrelated refreshes. The shuffle,
betting rules, payout accounting and private-card filtering are unchanged.

## Validation handoff

Per `AGENTS.md`, validation defaults to **wait**: build and JavaScript syntax
checks only. The added live-bridge regression covers duplicate input, stale
acknowledgments, reconnection, progress/error notices and stopped-worker state.
It is written but has not been executed in this revision. No browser sessions,
screenshots, runtime tests or performance measurements were run.

Found / maintainer play-tests before marking the PR ready:

- Complete practice hands using all action types, preset sizes, short all-ins,
  free refills and automatic dealing; compare chip totals and showdown results.
- Use all table filters and the table switcher as a spectator. Walk while
  seated, return on your turn, then deliberately leave after a practice hand.
  Verify Escape, keyboard focus, optional turn sounds and mirror round trips.
- Check phone portrait and landscape, narrow desktop windows, zoomed text and
  all five themes in the built page. Confirm cards, nine seats, bets and action
  controls remain readable and reachable without horizontal scrolling.
- Complete a live hand with two signed-in accounts. Interrupt and restore the
  network, delay an accepted action response, reload, reconnect a stopped
  worker and exit during initial connection. Check the turn timer and that no
  second action can be submitted while a move is uncertain.
- Walk a spectator between floor and table voice, with an occupied seat
  walking and returning too. Check visual presence and private-card boundaries.

Keep the existing browser STOP ledger in force. These are acceptance tasks for
the maintainer, not authorization to retry a blocked browser session. Live
deployment and encrypted recovery also require the checks in
[poker-integration.md](poker-integration.md).
