# Ooga Booga Land

A small WebGL2 floating island whose cliff caves are projects. The open cave is a lab
where donated bananas feed voxel cavemen who stand in for the contributors of
[EntropyLab](https://github.com/w-s-bitcoin/entropylab). Contributors eat when they
have committed recently, sleep when they have not, and hand-build lab equipment between
meals. Visitors can poke the crew, roll the dice, and watch donated bananas rain onto the
shared pile on the island and in the cave alike.

Everything is plain JavaScript with no dependencies, no build requirement, and no
network access. The page cannot make a request, payments are a simulator for now, and
all visitor state stays in the visitor's own browser (for now).

## Run it

Open `src/index.html` in a browser, or serve `src/` with any static server.

The page lands on the hub: a floating island whose cliff caves are the projects. Tap the
lit cave to enter EntropyLab; **Escape** or the **Leave cave** button brings you back.
The 9 o'clock cave is **Ooga Rally**, a kart race the size of a world: pick an Ooga, a
ride (on foot, a Rock Kart or a Dino) and one of three tracks (Banana Bay, Lava Gorge,
Frost Peak), then race the crew over three laps.

The 5 o'clock cave is **MrHodl's Den**, a quiet bedroom: walk to the bed or press
**Space** beside it to sleep, **Space** again to wake, **Escape** to wake and then leave.

The island keeps your local date and time. The sun, moon, stars, sky, light and shadows
move continuously through dawn, morning, noon, dusk, night and midnight; the torches, the fire pit and the sign lanterns light at dusk,
butterflies give way to fireflies, the crew gathers at the fire and talks about the hour,
and a shaken tree at night scatters fireflies.

Fly around the island with **W A S D** (or the arrows), **Q E** to turn, **R F** to tilt,
**Z** or **Space** up and **X** down; drag to orbit and scroll to zoom. On a phone the left
stick moves and the right stick looks. Double-tap a caveman to walk in their boots: the same
keys or stick walk them, holding **both mouse buttons** walks them forward, **Space** (or
the Ooga! button) eats from the pile, pokes a neighbour, shakes a tree, rustles a bush,
rolls a die or flips a card, and walking into the lit cave enters it. **Escape** lets go. Lost? **0** or the **Reset view** button
brings the camera home.

In Ooga Rally, **W** or **Up** accelerates, **S** or **Down** brakes and reverses, **A D**
or **Left Right** steer, **Space** held drifts (release for a boost, tap to hop), **E** or
**Shift** throws the item, **Q** looks back, **0** resets the camera behind you, **M**
mutes the synthesized sound and **Escape** pauses. Bananas on the track fill a turbo meter; crates hand out a Rock, a Peel,
a Turbo or an Ooga Shout. On a phone the left stick steers with the throttle held, **Drift**
and **Throw** buttons do the rest. Best times and medals are kept per track in your browser.
Finish on the podium and **Next track** takes you to the following track; **Cup** races
all three in a row for points and a saved cup medal. Now and then a race loads in the rain
(snow on Frost Peak) and the tarmac gets slick; the sound is synthesized in the browser,
nothing is downloaded.

On the roof of the Ooga Rally cave sits a plane: tap it, or walk a driven Ooga up to it, for
**Ooga Drop**. Pick an Ooga and **Fly!**: the plane climbs in a circle while the island shrinks
below (hold **Space** to hurry), **GET READY!** and **JUMP SOON!** call the mark as it comes
round once a lap, **JUMP** opens it, and Space throws you
out. In freefall **W S** pitch, **A D** roll and **Q E** turn the body, and the air answers the
way it does to a flat plate: belly down is slow and steady, head down is fast, a tilt tracks
you sideways. Fall through the glowing hoops, then Space pulls the chute; **A D** steer the
canopy on the same keys: **W** dives, **S** flares, **A D** bank, **Q E** turn. Any landing under
the canopy is a good one, the target pays by distance and the banana pile is a great one. Without a
chute the impact picks its ending: spine first punches a hole, flat and fast tumbles, flat and
slow flattens. Miss the island and you are lost in the clouds. Drag to look round in every
phase, all the way round in flight, where the view eases back behind you a moment after you let
go; **0** puts the camera back, **M** mutes the synthesized engine, wind and canopy,
**Escape** returns to the board. On a phone the left stick pitches and rolls, the right stick
turns, and the button jumps, pulls and flares. The best drop is kept in your browser.

Keys: **B** add 100 test bananas, **J** give the controlled Ooga a jetpack, **L** legendary
tip, **P** fill the pile, **1** to **9** force a contributor to eating, **Escape** leave a
cave or let go, **Shift+R** reset the demo.

URL flags: `?scene=lab` opens the lab directly, `?scene=race` the rally garage and `?scene=drop` the drop board, `?nosim=1` silences simulated tips,
`?canvas2d=1` forces the Canvas 2D fallback, `?yaw=1.2` sets the starting camera angle,
`?debug=1` exposes `window.__ooga`. In debug mode, add `&bananas=10000` (or another
non-negative amount) to preview the pile at that starting level without changing saved state,
use `&b=500` to choose how many test bananas each press of **B** adds and drops, use
`&hour=22` to pin the clock at an hour, `&day=172` to choose a day of year, or
`&daylen=120` to run a whole day in that many seconds. `&latitude=20` optionally changes
the debug latitude (bounded to 66 degrees north or south). Use `&loot=1` to exercise the loot feature. Loot ships off: `LOOT_DEFAULT` in `src/js/director.js`
turns it on for everyone. The pile holds at most ten million bananas; every count is clamped there.

## Test

```sh
npm test
```

Runs a headless Chrome suite over the DevTools protocol: real drags, clicks, and keys
against the page, with a clean console required. Needs Node 22 or newer and Chrome; the
driver looks for Chrome at the macOS application path, so on Linux or Windows set the
`CHROME` environment variable to the binary. There are no npm dependencies. A full run
takes about five minutes.

## Build and deploy

```sh
npm run build
```

Writes `oogaboogaland.html` at the repo root, a single self-contained page with the
stylesheet and every script inlined and the content policy pinned to their hashes. It is
committed with the sources; rebuild it whenever they change. Deploy that one file, served
as `index.html`. Nothing under `src/` goes to a server.

GitHub Pages deploys through `.github/workflows/pages.yml` on pushes to `rock`, or
manually with **Actions → Deploy GitHub Pages → Run workflow**. The workflow rebuilds
the page and uploads only `_site/index.html`, a copy of `oogaboogaland.html`.
Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**.
The default site URL is https://oogaboogax.github.io/oogaboogaland/.
Configure a custom domain in **Settings → Pages** before pointing its DNS at GitHub;
this workflow does not need a repository `CNAME` file.

## Privacy

No analytics, no external requests, no personal data. The roster lists public
contributor handles only. The donation handle and message a visitor types are stored in
their own localStorage and nowhere else.

## Contributing

Read [AGENTS.md](AGENTS.md) first. It describes the module layout, the engine patterns
the code relies on, how to add props, swag, behaviors, and HUD elements, and the checks
every change must pass.
