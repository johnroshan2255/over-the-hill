# The companion and the enemy (branch `companion`, 2026-11-19; the fight made again: 2026-11-21)

The user: "a companion in no-coop mode … a human body, cars, all like us … when I walk he walks with me, about a 100 m
range; when I drive he follows me around; and I can take him in my car." Then: "normal play will not have this guy — I
turn it on in settings like the bot; another option, enemy: he becomes my enemy, tries to hit me with his car, hits my
car … make punching and kicking and a lot of animation in Blender and use it."

**SETTINGS › PLAY › Companion: Off (the default) / Companion / Enemy** — solo play only, taken at once
(`settings.companion`, `?companion=friend|enemy`). `src/oth/Companion.ts`; an NPC run in the tab, no server.

| | |
|---|---|
| **drawn with** | the co-op player's own pieces: `Character` (one skinned draw; his jacket in another colour — `Character.tint`: blue the friend, red the enemy), `RemoteCar` (your car's model in his paint, solid in the physics), the name tag, the map and the minimap |
| **walks** | through the physics as you do (`Character.steer`: the game steers him, not the keys) — beside you on your right; walks, runs, sprints by the gap; 100 m off or stuck 2.5 s: put by you |
| **rides** | you get in with him within 15 m: he walks to the passenger door and sits (the seated clip, hands on his knees); you get out, he gets out. `H` calls him (on foot: to you; stopped in the car with his car close: he leaves it and gets in) |
| **follows by car** | you drive off without him: his own car is brought beside him, he gets in and follows ALONG YOUR WAY (your path replayed a gap behind, the gap growing with the speed; the car's tilt from the ground under its wheels — its own ray, never its own box) |
| **the enemy on foot** | closes in and fights as a man does (2026-11-21): CIRCLES you at a walk with his guard up and his eyes on you (`Character.steer.face`), throws a RUN of blows — each out of the last as it lands (`RUNS`: jab-cross, jab-jab-cross, jab-cross-hook, a cross and a hook to the body, a low kick, a jab and a roundhouse … a knee when he's right on you) — and steps off; he SEES yours coming a fifth of a second out and one time in three covers up (a fifth of it taken on the arms: `block_hit`), slips back from a punch or ducks under one at his head. A blow lands at its clip's moment if you're still in reach and in front; strength 100 each (his on his tag, yours a bar bottom left), back after 5 s without a blow; at 0 by fists: down (`knockdown`, `getup_back`), up again whole. KILLED by a weapon he drops where he stands — back if it came from the front (`die_back`), onto his face from behind (`die_fwd`) — lies there, and is back from behind you after 4.5 s |
| **a blow taken** (`BLOW`) | as that blow is: the head back (jab, cross, uppercut), whipped to one side (the hook, the roundhouse), folded over the belly (the body hook, the knee, the front kick), the leg knocked from under him (the low kick), staggered (a heavy one on a man already hurt); he is thrown back by it (`Character.push` — through the controller: a wall stops him), the two of you HELD on the frame it lands (`Character.hitStop`, 45–90 ms), the view jolted (`ChaseCam.shake`; first person's rattle), dust knocked out where it lands. A weapon's hit: the same by where it lands — head, body, leg — thrown the way the bullet came |
| **you** | `J` a punch, `U` a kick — pressed again as each LANDS the next is thrown straight out of it: jab → cross → hook → uppercut → a hook to the body; a low kick → a front kick → a roundhouse (a knee when he's right on you); a short step into each; turned to him if he's close; phones: PUNCH / KICK buttons |
| **the enemy by car** | never rides with you; takes his own car, comes right up your way and RAMS (your body shoved by its own mass, spun a little; his own checked by it, the view jolted), BACKS OFF 16 m on his own wheels, comes again; you on foot: he drives at you within 45 m (a hit: you go down), pulls up, gets out and fights; back in the cars, his joins your way again from where it stands. A RAM is given only with his car's body ON yours (the two boxes as they lie — round 4, docs/WEAPONS.md: it was their middles within a length, so he "hit" from alongside or a bumper's gap off). (2026-11-21, the user: "when the enemy's car hits me it goes 100 m back": dropping back it was simply PUT at its gap — a jump in one frame — and after driving at you on foot it was put back where it had left your way: both gone; `enemy.mjs` watches the furthest his car moves in a frame) |
| **the fight's clips** | made in Blender, by hand in code — `scripts/oth/fight.py` → `assets/models/human/fight.glb` (animations only, matched to the bones by name: `Character.loadClips`; 336 kB, loaded when a fight first needs it). The user, 2026-11-21: "the action and animation need more, it must feel real … if you use Mixamo it will look bad, make it custom using Blender". A move is written as a few POSES in the rig's own space (the hips, the spine's turn, each hand and ankle where it must be, the head); what is made of them (`anim`): every frame worked out and keyed; THE BODY LEADS THE HAND — each part read a little ahead of or behind the clock (`LAG`: feet and hips first, the fist on time, the head last; a blow taken runs the other way, `REACT`) —; a strike gathers speed all the way to its target ('in'), a recovery leaves fast and settles ('out'), a guard snaps home past itself ('spring'); hands, feet and hips travel on curves through the poses. 24 of them: `guard`; `jab` `cross` `hook` `uppercut` `body_hook`; `knee` `kick_front` `kick_round` `kick_low`; `block` `block_hit` `dodge` `duck`; `hit_head` `hit_head_l` `hit_head_r` `hit_body` `hit_leg` `stagger`; `knockdown` `die_back` `die_fwd`; `taunt`. `PREVIEW=<dir>` renders a FILM STRIP of every clip (`ONLY=jab,cross`, `VIEW=side`): the motion read at a glance; `BLEND=<file>` saves the rig with its actions, `FROM=<file>` exports one edited by hand |

Tests (headless Chrome, `npm run dev` first): `scripts/harness/companion.mjs` (the friend: 11 checks),
`scripts/harness/enemy.mjs` (the enemy: 13 — with his car never jumping), `scripts/harness/fightshots.mjs` (the
fight seen from beside you, a frame every 110 ms: his runs, your punches, your kicks),
`scripts/harness/companioncost.mjs` and `weaponcost.mjs` (what it costs — docs/WEAPONS.md).

Left: no sound for the blows; the clips are in place — a blow's step in and the man thrown back are the game's push,
not the clip's own travel; you neither block nor dodge (he does); his car follows your way with no thought for what
stands on it now (a tree felled since, your parked car) and drives straight at you over open ground when he runs you
down (through a tree, if one is between); the passenger gets in and out without the door's clip; he is one man — the
same body as yours in another jacket.

## Round 5 (2026-11-21, later): his car on yours

The user, after playing with car damage on: "when it hits me it goes back like it bounced off a balloon … hit on the
side, it does not touch my car's side … it must hit the car, not an invisible outer layer." What it was and what was
done: `docs/NEXT_damage.md` §1; what bites: its §3. In short — his car's way is made in the physics' own steps
(`fixed` → `drive`), drawn between them; what is solid of it is its own shape; `reach` stops it where its nose meets
your car's body; a ram is a dead blow and he stays on you, pushing, before he lets go; your car's CCD is off while
his is near. Checked by `scripts/harness/ramtest.mjs`.
