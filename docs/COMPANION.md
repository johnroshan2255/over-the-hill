# The companion and the enemy (branch `companion`, 2026-11-19)

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
| **the enemy on foot** | closes in, stands in his guard at arm's length, throws jab / cross / hook / uppercut / front kick / roundhouse; blocks one in four of yours; a blow lands at its clip's moment if you're still in reach and in front; strength 100 each (his on his tag, yours a bar bottom left), back after 5 s without a blow; at 0: down (the knockdown clip, `getup_back`), up again whole |
| **you** | `J` a punch (jab → cross → hook … ), `U` a kick — turned to him if he's close; phones: PUNCH / KICK buttons |
| **the enemy by car** | never rides with you; takes his own car, comes right up your way and RAMS (your body shoved by its own mass, spun a little), drops back 16 m, comes again; you on foot: he drives at you within 45 m (a hit: you go down), pulls up, gets out and fights |
| **the fight's clips** | made in Blender — `scripts/oth/fight.py` → `assets/models/human/fight.glb` (animations only, matched to the bones by name: `Character.loadClips`): `guard` `jab` `cross` `hook` `uppercut` `kick_front` `kick_round` `block` `dodge` `hit_head` `hit_body` `knockdown` `taunt` (+ the katana's — docs/WEAPONS.md). `PREVIEW=<dir>` renders every key pose; `BLEND=<file>` saves the rig with its actions, `FROM=<file>` exports one edited by hand |

Tests (headless Chrome, `npm run dev` first): `scripts/harness/companion.mjs` (the friend: 11 checks),
`scripts/harness/enemy.mjs` (the enemy: 11), `scripts/harness/companioncost.mjs` (what it costs — the table in
docs/WEAPONS.md).

Left: no sound for the blows; `dodge` is made but nothing plays it; his car follows your way with no thought for what
stands on it now (a tree felled since, your parked car) and drives straight at you over open ground when he runs you
down (through a tree, if one is between); the passenger gets in and out without the door's clip; he is one man — the
same body as yours in another jacket.
