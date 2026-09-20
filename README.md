# Ooga Booga Land

A small WebGL2 floating island whose cliff caves are projects. The open cave is a lab
where donated bananas feed voxel cavemen who stand in for the contributors of
[EntropyLab](https://github.com/OogaBoogaX/entropylab). Contributors work when their
latest repository activity is less than an hour old, chill for the rest of the first
day, and sleep after a day without activity. Working Oogas load banana ammunition
at the pile, run to their project's cave and shoot into it from outside, then return to reload.
Visitors can poke the crew, roll the dice, and watch donated bananas rain onto the
shared pile on the island and in the cave alike.

Everything is plain JavaScript with no dependencies, no build requirement, and no
network access. The page cannot make a request, payments are a simulator for now, and
all visitor state stays in the visitor's own browser (for now).

## Run it

Open `src/index.html` in a browser, or serve `src/` with any static server.

The page lands on the hub: a floating island whose cliff caves are the projects. Tap the
lit cave to enter EntropyLab; **Escape** or the **Leave cave** button brings you back.
The 9 o'clock cave is **Ooga Rally**: press **Space** nearby to open a kart race the size
of a world. Pick an Ooga, a ride (on foot, a Rock Kart or a Dino) and one of three tracks
(Banana Bay, Lava Gorge, Frost Peak), then race the crew over three laps.

The island keeps your local date and time. The sun, moon, stars, sky, light and shadows
move continuously through dawn, morning, noon, dusk, night and midnight; the torches, the fire pit and the sign lanterns light at dusk,
butterflies give way to fireflies, the crew gathers at the fire and talks about the hour,
and a shaken tree at night scatters fireflies. Climbing above the island lowers the
horizon haze, revealing more stars while their directions remain fixed in the sky.

Fly around the island with **W A S D** (or the arrows), **Q E** to turn, **R F** to tilt,
**Z** or **Space** up and **X** down; drag to orbit and scroll to zoom. On a phone the left
stick moves and the right stick looks. Double-tap a caveman to walk in their boots: the same
keys or stick walk them. **Right-click** while carrying a weapon enters third-person
shooting view with that weapon. **Space**
(or the **JUMP!** button) jumps: press once from the ground, then once more for a double
jump. Release between jumps; both reset after landing. While walking or airborne,
Space keeps its jump action. Stop beside a reachable control, bench, or Ooga Rally/Drop
launcher to use it with Space. The action button changes to
**PRESS IN**, **PRESS OUT**, **START RALLY**, or **FLY PLANE** while that control is nearby.
These actions work from every direction without needing to face them; the car's
platform and the plane's wings have room around them to activate the launcher. Click or tap
decorative props to interact with them. Walking into the lit lab cave enters it.
**Escape** lets go. Camera modes are **first-person**, **shoulder**, **orbit**, and
**detached**. The first three stay focused on the selected Ooga; detached is free roaming.
The leftmost equipment button shows only a face-on portrait while an Ooga is selected.
Press the portrait to switch between battle and carry mode without changing the camera
mode; **0** performs the same toggle. Hold it until the orange underline fills to detach. Detached mode shows the roaming
compass with five dots above it for Pile, Lab, Mirror, HQ, and Basement: press the compass to cycle
them, or press a dot to go directly there. The active dot turns orange and its destination
name briefly appears below the button.
Trees stay compact: you can walk through the lower half of their foliage and
stand on their upper canopy. Trunks and roots remain solid.
The banana pile's stone platform requires a jump; walking into its edge stops you.
The primary-weapon and **AK-47** buttons appear above the jetpack controls while driving an awake Ooga.
The primary icon matches that character's melee weapon. Click either button to select
its weapon without changing your view. In zoomed-out carry view, pressing the selected
primary button charges a swing and releasing strikes; a quick release pokes instead.
Its compact vertical gauge starts at 50% damage, rises to 100% for a brief press, and
fills to 200% when fully charged. In battle mode that button selects the primary weapon; use left
mouse on the island to swing. Clicking the selected AK button targets the closest visible
shootable item along the character's facing direction in carry view, adjusting vertically
as needed (or firing straight ahead if none is present), and uses the reticle in battle mode. **G** still
switches between weapons. When the rifle is put away, its compact count
shows loaded and spare rounds together. Equipping a weapon keeps your
current view. In carry mode, the stock rests by the front of the leg,
with the right hand lowered on the grip and the barrel angled up toward the
left hand, which turns to cradle the wooden grip.
Scrolling in changes orbit to shoulder view. In orbit battle mode the pointer stays captured,
the Ooga faces the view, and the reticle snaps vertically to the nearest clear target directly
ahead. Its spread grows with distance; a target beside the Ooga reduces the reticle to its dot
and is hit automatically. With no target, shots travel horizontally ahead. Right-click enters
shoulder view while retaining an acquired target. Third person uses an
above-head right-shoulder camera that keeps the whole character visible, with the
crosshair near the top of the head and over the right arm; first person keeps the
eye view. A page loaded directly in first person starts in battle mode with mouse-look focused;
the first canvas click upgrades it to unrestricted pointer lock. Shoulder and first-person
show a centered aiming reticle only in battle mode; switching to carry hides it without
moving the camera. While aiming, the left arm hangs naturally and swings with
walking. In battle mode, **WASD**
strafe and backpedal relative to the view without turning away from the target.
**Left mouse** fires the equipped gun or swings the primary melee weapon. A quick
click fires three bananas; holding continues into full auto at the same shot cadence.
Releasing during full auto stops immediately, keeping the exact remaining ammo.
Hold **right mouse** to aim down the gun's sights
or focus melee aim, tightening the view and slowing mouse sensitivity. Left-click
still attacks while right-click is held. **Space** reloads beside the pile and jumps
elsewhere (hold it to climb with a jetpack); **R** swaps the AK's loaded magazine with your fullest spare
while in shooting mode, and **Shift** sprints forward. **Escape** or **Tab**
frees the mouse for UI controls and pauses mouse aiming. The next click on the island
hides the cursor without attacking; subsequent clicks fire or swing while it is hidden.
**1** selects the club or assigned primary melee skin; **2** selects the rifle and
carries the primary weapon diagonally across the back. Neither key changes the camera; **0** toggles
battle and carry without changing it. In battle mode the club is held outward: a quick left-click
release pokes forward for half damage; a brief press swings for normal damage.
Hold longer to raise the weapon and charge up to double damage, then release to strike.
The same duration-based gestures work with a mouse, trackpad, or the carry-view melee button.
Focused aim boosts an ordinary swing to 150%; a full charge reaches 200%, without multiplying those bonuses.
The arm and wrist extend toward the aimed spot for the weapon's full reach. An orange
melee reticle selects the object that receives the hit. Axe pokes preserve the blade's
orientation. After an attack in carry view, the weapon stays ready for half a second,
then smoothly lowers back into its carry pose over a quarter second.
Scroll inward from orbit to the closest view to enter shoulder view with the
last selected melee weapon or rifle, swooping toward the point under your cursor.
The pointer glides into the centered aiming dot along with that camera transition.
Four separated arcs show the rifle's shot spread: bananas cluster around the dot
with a normal distribution bounded by the circle. Holding right-click tightens
both the circle and the spread smoothly while the dot stays centered.
The center dot turns green over reachable friendly characters and orange over
reachable interactive objects; red is reserved for enemies. It stays neutral when
the target is blocked or beyond the equipped weapon's reach. A brief pulse in the
target's color confirms an actual banana or club hit. The club uses its extended
reach; a hit on a friendly character does not cause damage.
If a wall between the camera and character blocks that view, the camera moves
into shoulder position while the character keeps their existing aim.
Each scroll gesture stops at shoulder aim;
pause, then scroll inward again for first person.
Scroll outward once for shoulder aim, then again for centered navigation and
further zooming out; one large outward scroll from shoulder aim can pull all the
way back. Zoom follows your chosen angle with a gentle added downward tilt,
keeping the distant view shallow; beneath a ceiling, zoom stays horizontal.
Zooming out keeps your selected weapon equipped. Mouse clicks on the island attack
only in battle mode; the weapon buttons also work in carry mode.
Focus returns to the character at the start of the outward zoom, even if you stop scrolling partway.
Moving the mouse moves the pointer; drag to rotate the camera as before.
**Escape** or **Tab** releases the normal browser cursor.
Burning keeps your current view but blocks swings and shots; press **Space** to
drop and roll, then attack again once the fire is out.
**V** also uses the selected weapon. Each rifle burst has one kick and flash per banana.
While you control a worker, putting the rifle away carries it on their back. The expanded control shows an
exact count out of **30** and thirty tiny banana indicators. The rifle's magazine window holds nine banana marks,
each representing three shots, with another three shots in the hidden chamber.
Each character keeps their ammunition between cave visits.

One full spare magazine is hidden in a bush or tree. Click its hiding place to reveal it,
then touch the hovering magazine with your character to collect it. A character can carry
two spares together on the left hip, with the fuller one toward the front and the lower-ammo one behind it. Breakable props can
drop additional full magazines. With two spares already owned, a pickup replaces the
least-filled magazine, including the one in the AK; a pickup stays on the ground if all are full.
While the AK is equipped, one spare-magazine button shows the fullest spare in front, with up to
five banana marks, one per six rounds, rounded down. With two spares, **2x** appears above the
highest ammo count, with the lowest count underneath. With the AK put away, its compact count
includes all three magazines and the spare button is hidden.
Press **R** in AK shooting mode, or click the magazine button, to select the fullest spare and swap
magazines. The right hand lowers the rifle as the left hand raises the spare to meet it,
then the rifle rises and the left hand returns the exchanged magazine to the hip.
The motion takes just under half a second; ammo exchanges at the handoff, and firing waits until it finishes.
Magazines can be swapped even when their counts match. Spares stay with the character who collected them, including
after releasing control and between scenes. That character loses both on an abyss respawn.

Outdoor boxes, barrels, and rocks can be broken with weapons; vegetation is not a weapon target.
A box takes one ordinary melee swing, a barrel has 2.25 times its strength, and a rock has 4.25 times its strength.
Each AK shot deals half a normal swing's damage: boxes take two shots, barrels five, and rocks nine.
Each can be empty or drop one pickup: a banana marked **+10**, **+20**, or **+30**, a full magazine,
or a jetpack, from most common to rarest. Tougher props drop rewards more often and have better odds
of the rarer rewards. Touch a reward to collect it. Banana pickups refill the fullest magazine that still
has room first, then the others; excess ammo disappears. An already-owned jetpack gets refueled.
Broken props return after 30–60 seconds in a new clear meadow position, away from paths, the pile, and
other objects. Uncollected rewards disappear when respawning comes due; a crowded map delays respawning
until a safe position is available.

With the AK equipped, overlap any part of the circular path around the banana pile
and press **Space** once to eat and load. Each load feeds two bananas in sequence, adding **six
shots** total, up to 30. Each banana consumes one from the pile and adds three shots.
The right arm extends straight forward, like the shooting pose, to hold the AK upright, with its magazine turned
inward while the left hand grabs the bananas.
Reloading fills the AK first, then briefly shows it full before lowering it and raising
each spare that needs ammo. While filling a spare, the AK goes on the back and the
right hand holds the spare sideways at the same angle as the AK's magazine for the left hand to load.
Finishing or interrupting the reload briefly lowers the spare and restores the AK;
firing with rounds available interrupts loading and fires once the rifle is back in position.
Once reloading starts, **Space**
jumps or jetpacks again while loading continues. Walking and jumping within reach keep
loading until all magazines are full; moving beyond the path or flying too far above or below
the pile edge, putting the gun away, or leaving control stops it. Completed rounds
stay loaded, and another press resumes. The first banana fills the hidden chamber, then the remaining nine pop
into the magazine one at a time. An empty weapon takes five loads, and an empty spare takes another five.
Partial loads preserve every round, using only the required fraction of the last banana. Interrupting
before a banana enters does not consume it. Empty piles cannot reload.
Put the AK away to restore the usual walking and nearby-control inputs.

Repository activity is tracked separately for each character and project. After a
magazine and a refill, workers visit their next recently active repository's open
cave in turn. Workers fan out on either side of the entrance, forming staggered
rows when the front row fills. They keep their rifles selected throughout the work cycle
and shoot at different points inside the cave, leaving the central path open.
After the last shot they briefly hold their empty rifle aimed, then lower it across
the body for the return to the pile. A worker with ammunition in their spare swaps it
in and empties it at the cave first, then returns to fill the AK and spare before the next trip.
The rifle stays held while filling its own magazine and goes on the back while filling the spare.
Walkers favor their right side of each curved path and leave room for one another.
Returning workers peel off near the pile for the closest open reload slot;
chilling Oogas and those heading to sleep go around active firing areas.
Chilling Oogas rest for a staggered 30–90 seconds between strolls, while still
moving promptly out of active work areas and responding to control or new activity.
Chilling walkers wait before crossing an approaching worker's route, then continue
once the worker has passed. Releasing a working Ooga sends them straight back to
their cave if they have ammunition, or to a free pile slot if empty, avoiding
obstacles on the way. Normal path-following resumes after that trip.
EntropyLab is the first registered work cave; adding a repository to
an open cave's `repo` field includes it in this rotation. See
[the activity data contract](docs/activity-contract.md) for the Oogatron snapshot
integration. Historical snapshot dates do not imply current activity.
The newest contribution keeps an Ooga in the clank state for four hours, chill through 48
hours, and sleep afterward.
Debug mode seeds three workers, three chilling Oogas, and two sleepers.
Roster labels show yellow for clank, orange for chill, and gray for sleep.
A separate dot before each roster name is green while a human controls that Ooga
and gray while offline; activity labels stay visible in either case. Hovered names
keep their existing dot colors: green while human-controlled, otherwise the activity
color. Future live global state can use the same presence indicator.

Landing on another Ooga carries you along with their movement. You can still
look around, walk across them, or jump off; walls and ceilings remain solid.

The jetpack starts spinning above a cloud beyond the island. Reach that cloud and jump
into the pack to collect it. The pack belongs to the Ooga who collects it: its compact
button appears only while that Ooga is selected, and stays hidden in detached mode or while
controlling another Ooga. Click it or press **J** to put that Ooga's jetpack on or take it off. The compact button
keeps a vertical fuel gauge visible and expands to the width of both weapon buttons to show a yellow fuel bar while the pack is worn. With the jetpack equipped,
tap **Space** on the ground for a weighted hop, half the height of a normal jump,
or hold it to keep climbing under thrust. Clicking an Ooga still shows a talking
bubble without making them hop.
A fresh press while airborne resumes thrust without adding another jump; a nearby
action still takes priority on its press. Thrust beneath the island glides outward
along the rock, past its stepped underside.
The jetpack icon and fuel bar on the left show the remaining fuel. A full tank lasts
eight seconds using **Space** or sixteen seconds using directional movement while
airborne. Combining both adds their fuel costs, lasting about 5.33 seconds. Walking
on the ground uses no fuel. Directional flight emits sparks at half the rate of Space;
combining both adds their spark rates too. Releasing the controls pauses fuel use
while airborne. Fuel refills in four seconds on the ground, including while the pack
is off. Empty fuel stops thrust and lets the Ooga fall without granting extra jumps.
Without thrust, falling uses the same gravity and speed with or without a jetpack,
regardless of its remaining fuel.
Landing with less than 20% fuel puts the jetpack in recovery until fuel recharges above
20%. During recovery, **Space** and the **JUMP!** button perform the standard double
jump even with the pack equipped; nearby controls still take priority. Toggling the
pack does not refill it or clear recovery. Entering the underground HQ, basement, or
their access ramps takes the pack off without losing it; it cannot be equipped there, except
inside the basement's central shaft. Fly up through that opening from below the
island; the pack comes off once you clear its lip onto the basement walking ring. The
compact button remains visible but disabled underground, and can equip the pack again
after returning above ground.
When its owner sleeps, the pack rests against the wall behind the bed beside their
primary and secondary weapons.

Wandering Oogas walk around the banana pile and keep off its platform rim.
You can still walk, jump, or fly through the fruit, with walking and vertical
movement at half speed. Leaving through its side or top scatters a brief burst
of bananas that tumble away and disappear. The platform has a stone
interior that joins the ground and banana interiors without gaps.
Returning Oogas choose the nearest free eating slot and choose again if someone
takes it before they arrive. The platform and fruit interiors follow the glyph
wave, switching to black with blurred green code as it reaches them.
NPC walkers check destinations for obstructions and use a bounded local recovery
path to back out of dead ends and go around scenery that blocks their route.
They keep clear of lit firepits when walking, choosing eating spots, and planning
recovery jumps; an Ooga already too close can still move out of the flames.
They follow the curves of connected surface paths slightly to their right, stepping off to pass
other Oogas or make the final approach to an off-path destination such as a
fireplace seat. A trailing Ooga headed to the same destination waits for a
comfortable gap before following. Routes
adapt when the growing pile changes the paths; player movement stays unrestricted.
When walkers meet, they turn the contacted shoulder back and sidestep past each
other while keeping their heads facing ahead, then return to their original lines.
This also works when overtaking: a moving Ooga bumped from behind turns that
shoulder forward. Solid scenery uses the same shoulder turn and temporary sidestep.
Centered bumps use the right shoulder; lighter grazes produce smaller turns and
sidesteps. Only moving Oogas react, and walls still limit the available space.
Routes through the lower ramps and room entrances round their corners wherever
the actual floor, walls and headroom leave enough space.
If no walking route is available, they can jump onto or over nearby items after
checking the flight and landing space. NPC recovery jumps stay outside the banana
pile and require enough headroom. Banana interior lighting includes exterior shadows at dawn.
An equipped pack stays on and recharges on the platform.
The blurred banana interior follows the daylight. In either camera view, it
shows eligible nearby outlines only through the covered part of the image.

You can fly above and beyond the island, or walk and jump off its edge. Steer through
an open window to enter HQ or the basement while falling. The windows widen toward
the outside with smooth stone reveals. Falling into the abyss plays a fall animation,
then returns your Ooga to the banana pile and turns Matrix mode off. A carried pack is lost in that fall and respawns
above another distant cloud. First person without a selected Ooga also
falls naturally and returns to the pile.

Land on the clouds to walk along their voxel tops and recharge your jetpack. A cloud
carries you as it drifts; walking off, or losing the cloud beneath you, starts a
natural fall. If the unclaimed jetpack's cloud disappears, the pack falls and then
respawns above another distant cloud. You can fly upward through clouds from below.

Scroll all the way in for first person, keeping your approach direction as the
Ooga turns to look that way. Walking has the same pace with or without a selected
Ooga, and both fall naturally when stepping off a ledge. Scroll out to return to the
trailing character view or free flight along the same viewing angle, even when
looking straight up or down. Both orbit views keep your chosen angle and distance
through the ramps. They can pass through walls, floors, and ceilings; a free orbit's
focal point can also move inside rock. Drag from floor level to directly overhead.
Rock covers the part of the view crossing a surface and fills the screen inside
stone. Its grain and color follow the actual section of rock. Faint boundary lines
and object silhouettes reveal nearby surroundings hidden from the camera. An object
gets its whole outline when any part is nearby and visible by looking around,
and the camera cannot see any part of it. Walls use the same proximity and
360-degree sight rules. The visible stretch reads as solid stone, including jagged
facets and small ledges, with a soft fill and a continuous outer outline. Its ends
fade where the wall passes out of the Ooga's sight. Ceilings and exterior window
sills, including their side panels and rock fragments, receive no outlines. The
thin wall below HQ's panoramic window and the basement shaft's open rim have cues.
Ramp wall cues meet the sloping floor along a continuous lower edge. Window
openings clip camera-visible portions precisely, preserving the wall around them.
Each wall fades at the distance limit; camera-visible portions do not receive the cue.
Walls and floors block cues from adjoining rooms
and other levels. These cues also work when the camera is outside
rock. Island stone and stone entrance frames activate the hidden-character cues;
trees, clouds, and other scenery do not activate them on their own. Those objects
remain eligible to receive outlines when stone blocks the view.
Object outlines soften near the distance limit and fade smoothly as sightlines
open or close. Nearby objects keep their eligibility as you turn or zoom the camera,
and additional characters never displace their cues. All outline cues switch off
immediately in first person or whenever any part of your Ooga is visible to the
camera, except for cues clipped to a rock or banana interior and the exterior ramp
view through windows. Small grass shoots receive no outlines. The pile's inner shell
and solid platform have separate wall-style cues, each with a soft fill and continuous border.
When part of the pile is exposed to the camera, its covered portion keeps its cue;
only the exposed pixels are removed, without drawing a new border along that cut.
Individual bananas and decorative base blocks do not participate in that cue's
visibility checks or outline rendering. A brighter outline locates your completely hidden Ooga.

The island's **PILE**, **LAB**, **MIRROR**, **HQ**, and **BSMT** buttons take your controlled Ooga,
or just your free camera, to that destination while keeping your current view mode.
**LAB** takes you to the EntropyLab entrance on the island; tap the cave or walk inside
to enter the lab. **MIRROR** takes you to the OBL mirror, **HQ** to the headquarters,
and **BSMT** directly to its basement. On narrow screens these destinations remain in
one horizontally scrollable row. Bananas pass through the mirror with small ripples in
its reflection; moving green glyphs briefly appear on each ripple's strongest ring, then fade before the water-like distortion.
Aim converges on the mirror under the reticle before the bananas continue through it.
A club strike that reaches the mirror creates the same brief ripple and green glyphs.
The first 20 damage spreads all the mirror's cracks without opening holes. After that,
each panel has one health point. Hits break panels near the impact; they fall, settle
flat on the ground and fade, leaving holes into the glyph room. Cracks stay thinner
at the rim. Two AK bananas or one default melee hit break a full-health panel;
extra damage from a stronger hit carries to the nearest next panel.
If any glass remains, it starts healing after three seconds without a hit. Each
missing panel slowly grows from its center back to its original cracked edges,
recovering health in proportion to its restored glass.
A fully missing panel takes 24 seconds to regrow; damaged panels that have not
broken also recover health.
Once every panel is restored, the cracks seal over 1.5 seconds;
damage that only made cracks goes straight to that final phase. A new hit preserves
repaired glass and crack contours away from the impact and restarts the quiet delay.
Once fully shattered, the mirror stays broken until the page reloads, including after
visiting another scene.
While any glass remains, the full mirror plane keeps the character's head and
first-person eye outside, even where panels are missing. Once the mirror is fully
shattered, that glass barrier disappears and the gate controls entry.
Approach the exposed gate to open it from either side. The room's control button
opens all five gates when pressed in and lowers them when pressed out; this inside
control can open the mirror bars before the glass is fully broken.
Characters, held weapons and moving pickups create glyph ripples at contact.
A faint moving green glyph outline remains along touching parts until they
clear the surface, releasing another ripple on exit. From outside with the room
button off, bright glyph mode starts exactly at the glass: only the parts behind it
change. While you are inside or the button is pressed in, all characters use full
glyph mode and the island's glyph wave stays active.
The room's floor, ceiling, walls and the path beyond the glass plane always show
glyphs, even with that button off; their exterior portions keep their usual material.
Inside HQ, two curved descents connect to a shared basement with
eight unclaimed rooms around a smaller common area. Each HQ and basement room has
one floor mattress in its rear corner, sized for a sleeping Ooga. Its blanket wraps
around the mattress, and the pillow carries the same LifeHash pattern rotated 90°,
derived from that room's x, y, z coordinates. Oogas already asleep when the world
loads start in their beds. Those who become sleepy later walk down the ramps to an
available bed and lie on top of the sheet. While lying down, their melee weapon and AK
lean against the wall behind the bed's head, returning to the character on waking.
Sleep follows contribution activity;
the debug number keys can wake a contributor for local interaction checks.
The HQ benches and fireplace are solid. Near a free bench seat, **Space** or **SIT**
sits facing the fire; movement or **STAND UP!** gets up. Touching a lit fireplace's
flames sets the Ooga on fire. Press **Space** or **DROP & ROLL!** once to roll back and
forth until the flames go out. Flames slowly climb from the legs while the Ooga delays
rolling; each burning part heats from red embers toward the fire's bright yellow.
During the roll, the glow cools smoothly into charred body colors. Touching another Ooga spreads
the fire. Burning NPCs panic and run at twice their normal walking speed before
dropping and rolling. Some react quickly; others run long enough for the flames
to cover their body. NPCs spot burning Oogas from farther away and flee at double
speed, leaving paths while avoiding obstacles and cliffs. At a safe distance they
remember the fire's last position and wait until it goes out or moves farther away
before resuming their routines.
Afterward, smoke rises and the charred parts fade back to their original colors.
Beds support walking: stand on an available mattress and press **Space** or **SLEEP**
to lie down.
Each bed holds one Ooga. While sleeping, **A/D** face left/right as seen from the foot
of the bed, **W** turns onto the stomach, and **S** onto the back; **Space** or
**WAKE UP!** gets up. Sleeping keeps your chosen camera distance.
Sleeping Zs appear when the sleeper, their doorway, or their window is in sight.
Double-click a sleeping Ooga to control them without waking them. Leaving control
keeps them asleep; **Space** or **WAKE UP!** wakes them when you are controlling them.
A single click gets a sleepy response and sometimes makes them roll over.
Walk between the levels without leaving the island. The basement rooms and ramps have exterior windows; its common area
has no fireplace. A wide central hole opens through the island's underside, with a
beveled stone rim and a broad walking ring connecting the rooms and ramps. Step into
the hole to fall through the island into the open air below.

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

On the roof of the Ooga Rally cave sits a plane: press **Space** nearby for **Ooga Drop**.
Approaching either game's launcher does not start it until you act. Pick an Ooga and
**Fly!**: the plane climbs in a circle while the island shrinks below (hold **Space** to
hurry), **GET READY!** and **JUMP SOON!** call the mark as it comes
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

Off the south rim a rope bridge leads to a floating islet with a launch pad: walk an Ooga over
and press **Space**, or tap the rocket, for **Ooga Orbit**. Build a rocket from Ooga parts (tap a part to add it, or drag it onto the rocket or into the list
exactly where you want it; drag a row to reorder it, or off the panel to take it away),
engine at the bottom and the pod on top: Volcano Jugs and Fire Pots and a Tusk Nozzle push,
Barrels, Big Coconuts and Nut Pods hold the fuel, a Bamboo Firecracker burns its own powder,
Vine Knots cut spent stages loose, Feather and Leaf Fins keep the nose pointed, and a Banana
Leaf, Mud Pack or Flat Stone shield sits under the Stick Cone or Gourd Pod. The board adds up
height, mass, push, the speed each stage can spend and the banana bill (Ooga NASA has no
budget, so the bill is only for show). In flight a checklist down the left keeps
the whole mission in view (launch, climb and arc, reach low orbit, spacewalk, drop home, shield
first, chute and land) with the step in hand lit and what it needs right now. **Launch!** counts down, the engines spool a gauge and
**Space** in the green lets go of the clamps (gold is perfect, early staggers, full pops). On
the way up **W S** push, and the autopilot flies a gentle arc along the yellow line (up is the
goal, so it tips no more than 40°); **A D** steer it yourself and **G** turns the
autopilot off for a hand-flown climb; lean too hard in thick air and it tears apart, push too
hard low down and it cooks. When a stage runs dry **Space** drops it and lights the next. Climb
to **low orbit**, 500 up (the height meter on the flight card shows how far there is to go), and
Ooga NASA steadies the rocket over the islands and holds it there, so home is always in view below. **Space** drops the rest of the rocket and keeps the pod. Then the
mission: **Space** again (or **V**, or the Spacewalk button) and your Ooga climbs out in a bubble
helmet and jetpack on a tether. **W A S D** fly where you look, **Q E** go down and up, drag to
look round; fly to the glowing space rock (bump into it and you get nudged gently back off) and **Space** measures it; the tether then reels the Ooga back to
the hatch and in by itself. One more **Space** leaves orbit: the pod falls shield down toward
the island by itself (**W A S D** turn it on puffs of air if it tips; shield first it glows and
survives, sideways it runs hot, nose first it burns up).
the pad for the big score, anywhere on the islands, or splash down in the sea. **0** puts the
camera back, **M** mutes, **Escape** returns to the builder. The best flight and your last rocket
are kept in your browser.

Keys: **B** add 100 test bananas, **J** toggle a collected jetpack on the controlled Ooga, **L** legendary
tip, **P** fill the pile, **1** to **9** force a contributor to eating when not controlling an Ooga
(**3** to **9** still do so while controlling), **Escape** leave a
cave or let go, **Shift+R** reset the demo.

URL flags: `?scene=lab` opens the lab directly, `?scene=race` the rally garage, `?scene=drop` the drop board and `?scene=orbit` the rocket builder, `?nosim=1` silences simulated tips,
`?canvas2d=1` forces the Canvas 2D fallback, `?yaw=1.2` sets the starting camera angle,
`?debug=1` exposes `window.__ooga`. In debug mode, add `&bananas=10000` (or another
non-negative amount) to preview the pile at that starting level without changing saved state,
use `&b=500` to choose how many test bananas each press of **B** adds and drops, use
`&hour=22` to pin the clock at an hour, `&day=172` to choose a day of year, or
`&daylen=120` to run a whole day in that many seconds. Use `&time=0000` for midnight
or `&time=1300` for 1 PM. `time` requires exactly four digits in valid 24-hour HHMM
format (hours 00–23, minutes 00–59); it stays fixed across scene changes and overrides
`hour` and `daylen`. Use `&view=pile`, `&view=lab`, `&view=mirror`, `&view=hq`, or
`&view=bsmt` to preload that island view, including when returning to the hub.
Add `&firstperson=1` for an initial
eye-level free camera, or `&character=w-s-bitcoin` to start controlling that contributor.
Combine them for first-person character control, including a starting location:
`?debug=1&firstperson=1&character=w-s-bitcoin&view=hq`. Add `&jetpack=1` to equip the
selected character on startup, or select the first working Ooga when `character=` is
omitted (the first roster entry if none is working). An explicit unknown handle leaves
selection untouched. With `view=hq` or `view=bsmt`, the pack stays owned with its icon
visible but disabled underground. These views skip automatic equipping and selection
while respecting an explicit `character=` or `firstperson=1`. `character`,
`firstperson`, and `jetpack` apply only on the initial page load. Add `&mag=1` in debug mode
to give the first character you control one full spare magazine, or `&mag=2` for two full spares;
they are not granted again after a fall. `&latitude=20` optionally changes
the debug latitude (bounded to 66 degrees north or south). Use `&loot=1` to exercise the loot feature. Loot ships off: `LOOT_DEFAULT` in `src/js/director.js`
turns it on for everyone. The pile holds at most ten million bananas; every count is clamped there.

Use `?debug=1&weapon=1` to start with the primary weapon held, or `&weapon=2` for the
AK. Add `&ammo=N` to set its starting magazine to a whole number from 0 to 30
(larger or negative values are clamped), or `&ammo=unlimited` for unlimited shots,
shown as **∞**. Unlimited firing never consumes the magazine or spare rounds;
swapping still exchanges their actual counts, and an empty swapped magazine can
still fire. These flags work on the hub and direct lab startup. They use `character=`
when supplied, otherwise the first working Ooga (or first available roster entry).
An unknown character or empty solo world remains unselected. Starting ammo is applied
once; later scene visits preserve the character's current ammo and unlimited mode.

In the hub, debug mode also shows a position readout by default; `&pos=0` hides it. Click the
readout to copy a URL that restores the exact character pose, camera, view mode and
equipment, including unequal spare loads and jetpack fuel. The copied `pose=` state
holds the displayed pose until movement, looking, zooming or an action resumes play.
For manual setup, use `&pos=x,y,z`, `&body=x,y,z` and `&head=x,y,z` (body/head angles
in radians), `&camera=x,y,z`, `&look=x,y,z`, and
`&mode=carry|shoulder|first-person|orbit|eye-level`. The position readout, manual pose
flags and copied pose replay are hub-only.

Add `&solo=1` (or bare `&solo`) in debug mode to load only the character named by
`character`; without a valid character, the world loads empty of characters. For example,
`?debug=1&solo=1&character=w-s-bitcoin` loads just that Ooga, while `?debug=1&solo=1`
loads the scenery alone. Solo stays active across scene changes, omits rally spectators,
and never selects a fallback character for `jetpack=1`. Use `solo=0` to restore the full roster.

Add `&status=clankin`, `&status=chillin`, or `&status=sleepin` with `debug=1` to force
every character's activity for the session. The setting survives hub/lab visits and
activity refreshes, and clankin characters can work at EntropyLab. It also applies with
`solo`; selecting a sleepin character keeps them asleep until you wake them normally.
Taking control still works, and releasing the character returns them to the chosen activity.

## Test

```sh
npm test
```

Runs a headless Chrome suite over the DevTools protocol: real drags, clicks, and keys
against the page, with a clean console required. Needs Node 22 or newer and Chrome; the
driver looks for Chrome at the macOS application path, so on Linux or Windows set the
`CHROME` environment variable to the binary. There are no npm dependencies. A full run
takes about nine minutes.

## Build and deploy

```sh
npm run build
```

Writes `oogaboogaland.html` at the repo root, a single self-contained page with the
stylesheet and every script inlined and the content policy pinned to their hashes. It is
committed with the sources; rebuild it whenever they change. Deploy that one file, served
as `index.html`. Nothing under `src/` goes to a server.

GitHub Pages deploys through `.github/workflows/pages.yml` on pushes to `rock`, every
ten minutes after refreshing the Oogatron activity snapshot, or manually with
**Actions → Deploy GitHub Pages → Run workflow**. The workflow rebuilds the page and
uploads only `_site/index.html`, a copy of `oogaboogaland.html`.
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
