//! THE WEAPONS BETWEEN PLAYERS (docs/WEAPONS.md, "The rules they share"; docs/NEXT_companion.md §1): the shooter's game
//! flies the bullet and says what it hit; the server checks the claim and owns everyone's health.
//!
//! The numbers are the game's own, `proto/weapons.json` (made from the specs by `scripts/oth/weapons.mjs`), read here as
//! `wire.rs` reads `wire.json` — one file, so the two sides can't disagree on a weapon's damage or its fire interval.
//!
//! A `hit` is taken only if: the shooter is up and holds that weapon; the target is another player, up, on foot; the
//! weapon's fire interval allows it (a bucket that fills one hit per `fireTicks` and holds two — two hits a tick apart
//! can arrive in one TCP read); the distance said is within the weapon's range; and the target's last pose is within
//! `distance ± SLACK` of the shooter's. The damage is worked out HERE from the spec — `damage × zone × max(floor,
//! e^(−2·drag·distance))` — never taken from the client.

use std::{collections::HashMap, sync::OnceLock};

use serde::Deserialize;

static WEAPONS: &str = include_str!("../../proto/weapons.json");

/// The player's health when whole.
pub const HEALTH: f32 = 100.0;
/// A player at 0 is down this long (ms), then back with full health (the spec: 5 s).
pub const DOWN_MS: u64 = 5000;
/// How far the target may be from where the shooter said (m): poses are ~50–150 ms old on both sides.
pub const SLACK: f32 = 3.0;

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Spec {
    pub damage: f32,
    pub head: f32,
    pub limb: f32,
    pub floor: f32,
    pub drag: f32,
    pub range: f32,
    pub fire_ticks: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct File {
    tick_hz: u32,
    weapons: HashMap<String, Spec>,
}

pub struct Table {
    pub tick_ms: f32,
    pub weapons: HashMap<String, Spec>,
}

pub fn table() -> &'static Table {
    static T: OnceLock<Table> = OnceLock::new();
    T.get_or_init(|| {
        let f: File = serde_json::from_str(WEAPONS).expect("proto/weapons.json");
        Table { tick_ms: 1000.0 / f.tick_hz as f32, weapons: f.weapons }
    })
}

pub fn spec(id: &str) -> Option<&'static Spec> {
    table().weapons.get(id)
}

#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Zone {
    Head,
    Body,
    Limb,
}

/// What a hit takes, by the spec: the zone's multiplier and the energy the bullet keeps over `dist`.
pub fn damage(s: &Spec, zone: Zone, dist: f32) -> f32 {
    let z = match zone {
        Zone::Head => s.head,
        Zone::Body => 1.0,
        Zone::Limb => s.limb,
    };
    s.damage * z * s.floor.max((-2.0 * s.drag * dist.max(0.0)).exp())
}

/// A player's side of the fight: what's in their hands, their health, when they may land the next hit.
#[derive(Debug, Clone)]
pub struct Fighter {
    /// The weapon in their hands ("" — fists / nothing).
    pub armed: String,
    pub hp: f32,
    /// Down until (ms since the epoch); 0 — up.
    pub down_until: u64,
    /// Hits in hand (the fire interval's bucket: one more each `fireTicks`, two at most) and when it was last filled.
    pub bucket: f32,
    pub bucket_at: u64,
}

impl Default for Fighter {
    fn default() -> Self {
        Fighter { armed: String::new(), hp: HEALTH, down_until: 0, bucket: 2.0, bucket_at: 0 }
    }
}

impl Fighter {
    pub fn down(&self) -> bool {
        self.down_until != 0
    }
    /// One hit spent from the bucket of the weapon armed — false: too soon after the last.
    pub fn spend(&mut self, s: &Spec, now: u64) -> bool {
        let every = (s.fire_ticks.max(1) as f32) * table().tick_ms;
        if self.bucket_at != 0 {
            self.bucket = (self.bucket + now.saturating_sub(self.bucket_at) as f32 / every).min(2.0);
        }
        self.bucket_at = now;
        if self.bucket < 1.0 {
            return false;
        }
        self.bucket -= 1.0;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_specs_load() {
        for id in ["pistol", "ak47", "sniper"] {
            let s = spec(id).expect(id);
            assert!(s.damage > 0.0 && s.range > 0.0 && s.fire_ticks > 0);
        }
        assert_eq!(table().tick_ms, 50.0);
    }

    #[test]
    fn damage_falls_with_distance_to_the_floor() {
        let s = spec("ak47").unwrap();
        let near = damage(s, Zone::Body, 0.0);
        assert!((near - s.damage).abs() < 1e-4);
        assert!(damage(s, Zone::Body, 200.0) < near);
        assert!((damage(s, Zone::Body, 1e6) - s.damage * s.floor).abs() < 1e-3);
        assert!(damage(s, Zone::Head, 10.0) > damage(s, Zone::Body, 10.0));
        assert!(damage(s, Zone::Limb, 10.0) < damage(s, Zone::Body, 10.0));
    }

    #[test]
    fn the_fire_interval() {
        let s = spec("sniper").unwrap(); // 30 ticks: 1.5 s
        let mut f = Fighter::default();
        assert!(f.spend(s, 1_000));
        assert!(f.spend(s, 1_010)); // (the bucket's second: two arrived in one read)
        assert!(!f.spend(s, 1_020));
        assert!(!f.spend(s, 2_000));
        assert!(f.spend(s, 2_600));
    }
}
