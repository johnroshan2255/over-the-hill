//! THE SKY of a live world (2026-11-25, the user: "check the weather and the daylight are synced with all players"):
//! the hour and the weather are the world's, not each game's — before this every game ran its own clock and rolled
//! its own spells, so two players stood at different hours under different skies. The server runs the very clock and
//! weather the game's Atmosphere.ts runs (the same numbers: a day of `DAY_MINUTES` real minutes, the night 3× faster;
//! spells of clear / cloudy / rain a few minutes each, the cloud, the rain and the wet easing between them) and tells
//! everyone `sky` on joining, every `SKY_EVERY` ticks and at once on a change; each game runs its own copy between
//! (smooth) and is set right by each. Anyone may change it (`sky` intent: a rest at camp, G / Shift + G): the world's.

use serde::{Deserialize, Serialize};

/// Real minutes for one daytime (06–18); the night runs 3× faster (Atmosphere.ts `dayMinutes`).
pub const DAY_MINUTES: f32 = 24.0;
/// Told to everyone every this many pose ticks (5 s): the games' clocks never drift further than that.
pub const SKY_EVERY: u32 = 100;

#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Weather {
    Auto,
    Clear,
    Cloudy,
    Rain,
}

#[derive(Debug, Clone)]
pub struct Sky {
    pub hour: f32,
    /// Pinned (G's weather), or `Auto`: the spells.
    pub weather: Weather,
    /// The spell now (never `Auto`), and its seconds left.
    pub spell: Weather,
    pub left: f32,
    pub cloud: f32,
    pub rain: f32,
    pub wet: f32,
    seed: u32,
}

impl Sky {
    pub fn new(seed: u32) -> Self {
        Sky { hour: 15.5, weather: Weather::Auto, spell: Weather::Clear, left: 240.0, cloud: 0.25, rain: 0.0, wet: 0.0, seed: seed | 1 }
    }

    /// The clock and the weather on by `dt` s; true if a new spell began (told at once).
    pub fn tick(&mut self, dt: f32) -> bool {
        let rolled = self.tick_weather(dt, true);
        let night = self.hour < 6.0 || self.hour > 18.6;
        self.hour = (self.hour + dt * 12.0 * if night { 3.0 } else { 1.0 } / (DAY_MINUTES * 60.0)) % 24.0;
        rolled
    }

    /// (`clock`: false to settle — the cloud, the rain and the wet to their targets without the spell running out:
    /// settling ran the spell's clock 400 s on, so a wait at camp could roll rain at once)
    fn tick_weather(&mut self, dt: f32, clock: bool) -> bool {
        let mut rolled = false;
        let mut kind = if self.weather == Weather::Auto { self.spell } else { self.weather };
        if self.weather == Weather::Auto && clock {
            self.left -= dt;
            if self.left <= 0.0 {
                self.seed = self.seed.wrapping_mul(1_103_515_245).wrapping_add(12345);
                let r = (self.seed >> 8) as f32 / 16_777_216.0;
                kind = if r < 0.45 { Weather::Clear } else if r < 0.75 { Weather::Cloudy } else { Weather::Rain };
                self.spell = kind;
                self.left = 180.0 + ((self.seed >> 4) % 240) as f32;
                rolled = true;
            }
        }
        let cloud_t = match kind {
            Weather::Rain => 0.95,
            Weather::Cloudy => 0.62,
            _ => 0.22,
        };
        let rain_t = if kind == Weather::Rain && self.cloud > 0.75 { 1.0 } else { 0.0 };
        let ease = |v: f32, t: f32, rate: f32| if v < t { (v + dt * rate).min(t) } else { (v - dt * rate).max(t) };
        self.cloud = ease(self.cloud, cloud_t, 1.0 / 60.0);
        self.rain = ease(self.rain, rain_t, 1.0 / 25.0);
        let wet_rate = if self.rain > 0.3 { 1.0 / 40.0 } else { 1.0 / 180.0 };
        self.wet = ease(self.wet, if self.rain > 0.3 { 1.0 } else { 0.0 }, wet_rate);
        rolled
    }

    /// Someone changed it: the hour (a rest, G), the weather pinned or back to its spells, or waited out (a rest at
    /// camp: a clear spell from now, settled at once — Atmosphere.clearSky).
    pub fn set(&mut self, hour: Option<f32>, weather: Option<Weather>, wait_out: bool) {
        if let Some(h) = hour {
            self.hour = h.rem_euclid(24.0);
        }
        if let Some(w) = weather {
            self.weather = w;
        }
        if wait_out {
            self.spell = Weather::Clear;
            self.left = 240.0;
            if self.weather != Weather::Auto {
                self.weather = Weather::Clear;
            }
            for _ in 0..400 {
                self.tick_weather(1.0, false);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_day_runs_as_the_games_does() {
        let mut s = Sky::new(7);
        s.hour = 12.0;
        // (one real minute of day: half an hour — 12 h in 24 min)
        for _ in 0..1200 {
            s.tick(0.05);
        }
        assert!((s.hour - 12.5).abs() < 0.01, "{}", s.hour);
        s.hour = 23.9;
        for _ in 0..200 {
            s.tick(0.05);
        }
        assert!(s.hour < 1.0, "the clock goes round: {}", s.hour);
    }

    #[test]
    fn spells_roll_and_a_wait_clears_the_sky() {
        let mut s = Sky::new(99);
        let mut rolls = 0;
        for _ in 0..20 * 60 * 30 {
            if s.tick(0.05) {
                rolls += 1;
            }
        }
        assert!(rolls >= 4, "half an hour: a new spell every 3–7 minutes ({rolls})");
        s.set(None, Some(Weather::Rain), false);
        for _ in 0..20 * 120 {
            s.tick(0.05);
        }
        assert!(s.cloud > 0.9 && s.rain > 0.5, "pinned rain: {} {}", s.cloud, s.rain);
        s.set(Some(6.5), None, true);
        assert_eq!(s.weather, Weather::Clear);
        assert!(s.rain == 0.0 && s.cloud < 0.3 && (s.hour - 6.5).abs() < 1e-6);
    }
}
