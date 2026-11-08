//! THE GROUND, as the client draws it: the map's 4 km playable box at 2 m (`public/oth/<map>/height.bin`, Uint16
//! 2049², rows along z; metres = min + raw · range / 65535 — `meta.json` `inner`). The server needs it to flatten,
//! dig ponds and put things on the ground. A map without the files is flat at 0 (tests).

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use anyhow::Context;
use serde::Deserialize;

pub struct Ground {
    pub n: usize,
    pub step: f32,
    pub origin: f32,
    /// Heights (m), rows along z; empty: flat at 0.
    h: Vec<f32>,
}

#[derive(Deserialize)]
struct Grid {
    n: usize,
    step: f32,
    origin: f32,
    min: f64,
    range: f64,
}

#[derive(Deserialize)]
struct Meta {
    inner: Grid,
}

impl Ground {
    pub fn flat() -> Ground {
        Ground { n: 2049, step: 2.0, origin: -2048.0, h: vec![] }
    }

    pub fn load(dir: &Path) -> anyhow::Result<Ground> {
        let meta: Meta = serde_json::from_slice(&std::fs::read(dir.join("meta.json")).context("meta.json")?)?;
        let raw = std::fs::read(dir.join("height.bin")).context("height.bin")?;
        let g = meta.inner;
        anyhow::ensure!(raw.len() >= g.n * g.n * 2, "height.bin is {} bytes, the grid needs {}", raw.len(), g.n * g.n * 2);
        let k = g.range / 65535.0;
        let h = raw.chunks_exact(2).take(g.n * g.n).map(|c| (g.min + u16::from_le_bytes([c[0], c[1]]) as f64 * k) as f32).collect();
        Ok(Ground { n: g.n, step: g.step, origin: g.origin, h })
    }

    /// Half the box's width (m): the playable area is |x|, |z| ≤ half.
    pub fn half(&self) -> f32 {
        -self.origin
    }

    /// The baked height at grid cell (i, j) (clamped).
    pub fn base(&self, i: i32, j: i32) -> f32 {
        if self.h.is_empty() {
            return 0.0;
        }
        let n = self.n as i32;
        let (i, j) = (i.clamp(0, n - 1), j.clamp(0, n - 1));
        self.h[(j * n + i) as usize]
    }

    /// Bilinear height (m) at world (x, z), clamped to the box.
    pub fn height(&self, x: f32, z: f32) -> f32 {
        if self.h.is_empty() {
            return 0.0;
        }
        let top = self.n as f32 - 1.0001;
        let fx = ((x - self.origin) / self.step).clamp(0.0, top);
        let fz = ((z - self.origin) / self.step).clamp(0.0, top);
        let (i, j) = (fx as i32, fz as i32);
        let (tx, tz) = (fx - i as f32, fz - j as f32);
        let a = self.base(i, j) + (self.base(i + 1, j) - self.base(i, j)) * tx;
        let b = self.base(i, j + 1) + (self.base(i + 1, j + 1) - self.base(i, j + 1)) * tx;
        a + (b - a) * tz
    }

    /// The grid cell nearest (x, z).
    pub fn cell_of(&self, x: f32, z: f32) -> (i32, i32) {
        (((x - self.origin) / self.step).round() as i32, ((z - self.origin) / self.step).round() as i32)
    }

    /// A cell's world position.
    pub fn cell_pos(&self, i: i32, j: i32) -> (f32, f32) {
        (self.origin + i as f32 * self.step, self.origin + j as f32 * self.step)
    }
}

/// The maps' ground, each loaded once.
pub struct Maps {
    dir: PathBuf,
    cache: Mutex<HashMap<String, Arc<Ground>>>,
}

/// The maps a world can be made on.
pub const MAPS: [&str; 2] = ["valley", "desert"];

impl Maps {
    pub fn new(dir: PathBuf) -> Maps {
        Maps { dir, cache: Mutex::new(HashMap::new()) }
    }

    /// The ground of `id` (blocking: the first call reads ~8 MB).
    pub fn get(&self, id: &str) -> Arc<Ground> {
        if let Some(g) = self.cache.lock().unwrap().get(id) {
            return g.clone();
        }
        let g = if id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            match Ground::load(&self.dir.join(id)) {
                Ok(g) => g,
                Err(e) => {
                    tracing::warn!("map {id}: {e:#} — flat ground");
                    Ground::flat()
                }
            }
        } else {
            Ground::flat()
        };
        let g = Arc::new(g);
        self.cache.lock().unwrap().insert(id.to_string(), g.clone());
        g
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flat_and_cells() {
        let g = Ground::flat();
        assert_eq!(g.height(10.0, -30.0), 0.0);
        let (i, j) = g.cell_of(10.0, -31.0);
        assert_eq!(g.cell_pos(i, j), (10.0, -30.0));
        assert_eq!(g.half(), 2048.0);
    }

    /// The real valley, if it's there: heights are sane and match bilinear sampling at a cell.
    #[test]
    fn the_valley_loads() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../frontend/public/oth/valley");
        if !dir.join("height.bin").exists() {
            return;
        }
        let g = Ground::load(&dir).unwrap();
        assert_eq!(g.n, 2049);
        let (i, j) = g.cell_of(100.0, 100.0);
        let (x, z) = g.cell_pos(i, j);
        assert!((g.height(x, z) - g.base(i, j)).abs() < 1e-3);
        assert!(g.base(i, j) > 0.0 && g.base(i, j) < 1000.0);
    }
}
