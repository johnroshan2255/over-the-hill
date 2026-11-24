//! THE WEAPONS between players (docs/WEAPONS.md, "The rules they share"): the shooter's game flies the bullet and says
//! what it hit; the server checks the claim against the weapons' own numbers — proto/weapons.json, made from the spec
//! files (docs/weapons/*.md) and read by the game too — and owns everyone's health.
//!
//! A HIT is taken only if: that gun is in the shooter's hands (`arm`); a shot of it left in the last `SHOT_LIFE` ticks
//! and isn't spent yet (each `shot` is rate-limited by the gun's `fireTicks`: a bucket of 2 filled one every
//! `fireTicks` — the network bunches two now and then, never more in the long run); the distance said is within the
//! gun's range and agrees with the two players' last poses (± 3 m and 2 %). The DAMAGE is worked out here from the
//! spec — `damage × zone × max(floor, e^(−2·drag·distance))` — never taken from the client.
//! (A katana with two blades and their abilities was here till 2026-11-21: removed from the game whole.)

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::Value;

static DATA: &str = include_str!("../../proto/weapons.json");

/// What's in the hands (`fists`: nothing) — in a hit, what did it.
#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Weapon {
    #[default]
    Fists,
    Pistol,
    Ak47,
    Sniper,
}

#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Zone {
    Head,
    Body,
    Limb,
}

pub struct Gun {
    pub fire_ticks: u32,
    pub range: f32,
    pub damage: f32,
    pub head: f32,
    pub limb: f32,
    pub floor: f32,
    pub drag: f32,
}

pub struct Specs {
    pub health: f32,
    pub pistol: Gun,
    pub ak47: Gun,
    pub sniper: Gun,
}

/// A gun's shots live this long (ticks) waiting for their hit: the sniper's bullet takes 1.6 s to fly its 1000 m.
pub const SHOT_LIFE: u32 = 60;
/// Down this long (ticks) — then back, whole (the spec: out for 5 s).
pub const DOWN_TICKS: u32 = 100;

fn f(v: &Value) -> f32 {
    v.as_f64().unwrap_or_else(|| panic!("proto/weapons.json: a number, not {v}")) as f32
}
fn u(v: &Value) -> u32 {
    v.as_u64().unwrap_or_else(|| panic!("proto/weapons.json: a whole number, not {v}")) as u32
}

fn gun(w: &Value) -> Gun {
    Gun { fire_ticks: u(&w["fireTicks"]).max(1), range: f(&w["range"]), damage: f(&w["damage"]), head: f(&w["head"]), limb: f(&w["limb"]), floor: f(&w["floor"]), drag: f(&w["drag"]) }
}

pub fn specs() -> &'static Specs {
    static S: OnceLock<Specs> = OnceLock::new();
    S.get_or_init(|| {
        let d: Value = serde_json::from_str(DATA).expect("proto/weapons.json");
        let w = &d["weapons"];
        Specs { health: f(&d["health"]), pistol: gun(&w["pistol"]), ak47: gun(&w["ak47"]), sniper: gun(&w["sniper"]) }
    })
}

impl Specs {
    pub fn gun(&self, w: Weapon) -> Option<&Gun> {
        match w {
            Weapon::Pistol => Some(&self.pistol),
            Weapon::Ak47 => Some(&self.ak47),
            Weapon::Sniper => Some(&self.sniper),
            Weapon::Fists => None,
        }
    }
}

/// A player's side of the fight: their health, what's in their hands, the shots in the air.
#[derive(Default)]
pub struct Fight {
    pub hp: f32,
    pub weapon: Weapon,
    /// The shot bucket: how many may leave now (≤ 2), and the tick it was last filled.
    tokens: f32,
    filled: u32,
    /// The ticks of the gun's shots not yet matched by a hit.
    shots: Vec<u32>,
    /// Back up at this tick (None: standing).
    pub down_until: Option<u32>,
}

/// What a hit did: the damage.
pub struct Struck {
    pub damage: f32,
}

type R<T> = Result<T, String>;

impl Fight {
    pub fn new() -> Fight {
        Fight { hp: specs().health, tokens: 1.0, ..Default::default() }
    }

    /// Into the hands (`fists`: nothing).
    pub fn arm(&mut self, weapon: Weapon, now: u32) {
        if weapon != self.weapon {
            self.tokens = 1.0;
            self.filled = now;
            self.shots.clear();
        }
        self.weapon = weapon;
    }

    /// A shot: counted, its rate held.
    pub fn shot(&mut self, weapon: Weapon, now: u32) -> R<()> {
        if self.down_until.is_some() {
            return Err("you're down".into());
        }
        if weapon != self.weapon {
            return Err("that isn't in your hands".into());
        }
        let g = specs().gun(weapon).ok_or("fists don't shoot")?;
        self.tokens = (self.tokens + now.wrapping_sub(self.filled) as f32 / g.fire_ticks as f32).min(2.0);
        self.filled = now;
        if self.tokens < 1.0 {
            return Err("too fast".into());
        }
        self.tokens -= 1.0;
        self.shots.retain(|t| now.wrapping_sub(*t) <= SHOT_LIFE);
        if self.shots.len() < 64 {
            self.shots.push(now);
        }
        Ok(())
    }

    /// The shooter's claim that `weapon` hit someone in `zone`, `dist` m away (`real`: the distance between their last
    /// poses) — what it does, or why not.
    pub fn hit(&mut self, weapon: Weapon, zone: Zone, dist: f32, real: f32, now: u32) -> R<Struck> {
        if self.down_until.is_some() {
            return Err("you're down".into());
        }
        if !dist.is_finite() || dist < 0.0 || (real - dist).abs() > 3.0 + dist * 0.02 {
            return Err("they weren't there".into());
        }
        let g = specs().gun(weapon).ok_or("fists don't count here")?;
        if self.weapon != weapon {
            return Err("that isn't in your hands".into());
        }
        if dist > g.range {
            return Err("out of range".into());
        }
        self.shots.retain(|t| now.wrapping_sub(*t) <= SHOT_LIFE);
        if self.shots.is_empty() {
            return Err("no shot to hit with".into());
        }
        self.shots.remove(0);
        let z = match zone {
            Zone::Head => g.head,
            Zone::Limb => g.limb,
            Zone::Body => 1.0,
        };
        Ok(Struck { damage: g.damage * z * (-2.0 * g.drag * dist).exp().max(g.floor) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_numbers_are_the_specs() {
        let s = specs();
        assert_eq!(s.health, 100.0);
        assert_eq!(s.ak47.fire_ticks, 2, "600 a minute at 20 Hz");
        assert!(s.sniper.range > s.ak47.range);
    }

    #[test]
    fn a_gun_hits_only_with_its_shots_and_its_rate() {
        let mut f = Fight::new();
        f.arm(Weapon::Ak47, 0);
        // no shot yet: no hit
        assert!(f.hit(Weapon::Ak47, Zone::Body, 20.0, 20.0, 1).is_err());
        // a full-auto run: one every 2 ticks is taken; two in the same tick only from a full bucket
        f.shot(Weapon::Ak47, 10).unwrap();
        f.shot(Weapon::Ak47, 10).unwrap();
        assert!(f.shot(Weapon::Ak47, 10).is_err(), "a third in the same tick");
        for k in 1..=10 {
            f.shot(Weapon::Ak47, 10 + 2 * k).unwrap();
        }
        // each shot one hit, no more
        let mut taken = 0;
        while f.hit(Weapon::Ak47, Zone::Body, 20.0, 20.5, 31).is_ok() {
            taken += 1;
        }
        assert_eq!(taken, 12);
        // the damage from the spec: at the muzzle ×head in the head, less with the distance — never under the floor
        let g = &specs().ak47;
        f.shot(Weapon::Ak47, 40).unwrap();
        let near = f.hit(Weapon::Ak47, Zone::Head, 1.0, 1.0, 41).unwrap().damage;
        assert!((near - g.damage * g.head).abs() < 0.5, "{near}");
        f.shot(Weapon::Ak47, 50).unwrap();
        let far = f.hit(Weapon::Ak47, Zone::Body, g.range - 1.0, g.range - 1.0, 60).unwrap().damage;
        assert!(far >= g.damage * g.floor - 0.01 && far < near, "the floor: {far}");
        // beyond its range, the wrong gun, a distance that doesn't match the poses, fists
        f.shot(Weapon::Ak47, 70).unwrap();
        assert!(f.hit(Weapon::Ak47, Zone::Body, g.range + 1.0, g.range + 1.0, 71).is_err());
        assert!(f.hit(Weapon::Sniper, Zone::Body, 50.0, 50.0, 71).is_err());
        assert!(f.hit(Weapon::Ak47, Zone::Body, 50.0, 80.0, 71).is_err());
        assert!(f.hit(Weapon::Fists, Zone::Body, 1.0, 1.0, 71).is_err());
        // a shot too old to hit
        assert!(f.hit(Weapon::Ak47, Zone::Body, 50.0, 50.0, 70 + SHOT_LIFE + 1).is_err());
        // fists don't shoot; a gun not in the hands doesn't either
        assert!(f.shot(Weapon::Pistol, 200).is_err());
        f.arm(Weapon::Fists, 200);
        assert!(f.shot(Weapon::Fists, 210).is_err());
    }
}
