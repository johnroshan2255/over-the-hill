//! THE BUILD CATALOGUE — materials, what each piece costs, what each brush stroke costs. The client reads it from
//! `GET /v1/catalog` (one source of truth); the server charges from it.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mat {
    Wood,
    Stone,
    Metal,
}

pub const MATS: [Mat; 3] = [Mat::Wood, Mat::Stone, Mat::Metal];

/// An amount of each material.
#[derive(Clone, Copy, Default, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Bag {
    #[serde(default)]
    pub wood: u32,
    #[serde(default)]
    pub stone: u32,
    #[serde(default)]
    pub metal: u32,
}

impl Bag {
    pub const fn new(wood: u32, stone: u32, metal: u32) -> Bag {
        Bag { wood, stone, metal }
    }
    pub fn of(mat: Mat, n: u32) -> Bag {
        let mut b = Bag::default();
        *b.get_mut(mat) = n;
        b
    }
    pub fn get(&self, mat: Mat) -> u32 {
        match mat {
            Mat::Wood => self.wood,
            Mat::Stone => self.stone,
            Mat::Metal => self.metal,
        }
    }
    pub fn get_mut(&mut self, mat: Mat) -> &mut u32 {
        match mat {
            Mat::Wood => &mut self.wood,
            Mat::Stone => &mut self.stone,
            Mat::Metal => &mut self.metal,
        }
    }
    pub fn total(&self) -> u32 {
        self.wood.saturating_add(self.stone).saturating_add(self.metal)
    }
    pub fn is_empty(&self) -> bool {
        self.total() == 0
    }
    pub fn covers(&self, o: &Bag) -> bool {
        self.wood >= o.wood && self.stone >= o.stone && self.metal >= o.metal
    }
    pub fn add(&mut self, o: &Bag) {
        self.wood = self.wood.saturating_add(o.wood);
        self.stone = self.stone.saturating_add(o.stone);
        self.metal = self.metal.saturating_add(o.metal);
    }
    /// Takes `o` out if there is enough of everything; false (unchanged) if not.
    pub fn take(&mut self, o: &Bag) -> bool {
        if !self.covers(o) {
            return false;
        }
        self.wood -= o.wood;
        self.stone -= o.stone;
        self.metal -= o.metal;
        true
    }
    pub fn half(&self) -> Bag {
        Bag::new(self.wood / 2, self.stone / 2, self.metal / 2)
    }
    /// "4 wood, 2 stone" — what's missing, for messages.
    pub fn describe(&self) -> String {
        let mut parts = vec![];
        for m in MATS {
            let n = self.get(m);
            if n > 0 {
                parts.push(format!("{n} {}", mat_name(m)));
            }
        }
        if parts.is_empty() { "nothing".into() } else { parts.join(", ") }
    }
    /// What `self` lacks to cover `o`.
    pub fn short_of(&self, o: &Bag) -> Bag {
        Bag::new(o.wood.saturating_sub(self.wood), o.stone.saturating_sub(self.stone), o.metal.saturating_sub(self.metal))
    }
}

pub fn mat_name(m: Mat) -> &'static str {
    match m {
        Mat::Wood => "wood",
        Mat::Stone => "stone",
        Mat::Metal => "metal",
    }
}

/// On foot: a log on the shoulder or an armful of stones.
pub const CARRY_CAP: u32 = 4;
/// The jeep's trailer.
pub const TRAILER_CAP: u32 = 40;

#[derive(Serialize)]
pub struct PieceDef {
    pub kind: &'static str,
    pub name: &'static str,
    pub group: &'static str,
    pub cost: Bag,
}

const fn p(kind: &'static str, name: &'static str, group: &'static str, cost: Bag) -> PieceDef {
    PieceDef { kind, name, group, cost }
}
const fn w(n: u32) -> Bag {
    Bag::new(n, 0, 0)
}
const fn s(n: u32) -> Bag {
    Bag::new(0, n, 0)
}

/// Every piece that can be built (the kit: docs/MULTIPLAYER.md §4). Kinds are the client's model names.
pub const PIECES: &[PieceDef] = &[
    // foundations and floors
    p("foundation_stone", "Stone foundation", "foundation", s(6)),
    p("foundation_wood", "Timber foundation", "foundation", w(4)),
    p("floor_plank", "Plank floor", "foundation", w(3)),
    p("steps_stone", "Stone steps", "foundation", s(3)),
    // walls
    p("wall_log", "Log wall", "wall", w(4)),
    p("wall_log_window", "Log wall, window", "wall", Bag::new(3, 0, 1)),
    p("wall_log_door", "Log wall, door", "wall", Bag::new(3, 0, 1)),
    p("wall_stone", "Stone wall", "wall", s(6)),
    p("wall_stone_window", "Stone wall, window", "wall", Bag::new(1, 5, 0)),
    p("wall_stone_door", "Stone wall, door", "wall", Bag::new(1, 5, 0)),
    p("wall_plank", "Plank wall", "wall", w(3)),
    p("wall_garage", "Garage door wall", "wall", Bag::new(2, 0, 4)),
    // roofs
    p("roof_shingle", "Shingle roof", "roof", w(3)),
    p("roof_shingle_ridge", "Shingle ridge", "roof", w(1)),
    p("roof_tin", "Tin roof", "roof", Bag::new(1, 0, 2)),
    p("chimney_stone", "Stone chimney", "roof", s(5)),
    // porch and yard
    p("porch_deck", "Porch deck", "yard", w(3)),
    p("porch_post", "Porch post", "yard", w(1)),
    p("fence_rail", "Rail fence", "yard", w(1)),
    p("fence_gate", "Fence gate", "yard", Bag::new(1, 0, 1)),
    p("wall_drystone", "Dry-stone wall", "yard", s(3)),
    p("jetty", "Jetty", "yard", w(4)),
    p("campfire", "Fire ring", "yard", s(3)),
    p("lamp_post", "Lamp post", "yard", Bag::new(1, 0, 2)),
    p("bench", "Bench", "yard", w(2)),
    p("table", "Table", "yard", w(3)),
    p("woodpile", "Woodpile shelter", "yard", w(2)),
    // the garden
    p("plant_pine", "Pine sapling", "plant", w(1)),
    p("plant_birch", "Birch sapling", "plant", w(1)),
    p("plant_hedge", "Hedge", "plant", w(1)),
    p("plant_flowers", "Flower bed", "plant", Bag::new(0, 0, 0)),
    p("plant_veg", "Vegetable patch", "plant", w(1)),
    // whole buildings
    p("prefab_shed", "Shed", "prefab", Bag::new(12, 4, 1)),
    p("prefab_cabin", "Log cabin", "prefab", Bag::new(40, 16, 4)),
    p("prefab_garage", "Garage", "prefab", Bag::new(24, 20, 10)),
];

pub fn piece(kind: &str) -> Option<&'static PieceDef> {
    PIECES.iter().find(|d| d.kind == kind)
}

/// Paving: what a stroke of radius `r` costs in `mat` ("stone", "gravel", "planks", "dirt", "erase").
pub fn pave_cost(mat: &str, r: f32) -> Option<Bag> {
    let units = ((std::f32::consts::PI * r * r) / 8.0).ceil().max(1.0) as u32;
    match mat {
        "stone" | "gravel" => Some(s(units)),
        "planks" => Some(w(units)),
        "dirt" | "erase" => Some(Bag::default()),
        _ => None,
    }
}

pub fn catalog_json() -> serde_json::Value {
    serde_json::json!({
        "mats": MATS,
        "carry": CARRY_CAP,
        "trailer": TRAILER_CAP,
        "pieces": PIECES,
        "pave": ["stone", "gravel", "planks", "dirt", "erase"],
        "pave_area_per_unit": 8.0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bag_math() {
        let mut a = Bag::new(5, 2, 0);
        assert!(a.take(&Bag::new(4, 0, 0)));
        assert_eq!(a, Bag::new(1, 2, 0));
        assert!(!a.take(&Bag::new(2, 0, 0)));
        assert_eq!(a, Bag::new(1, 2, 0));
        assert_eq!(a.short_of(&Bag::new(3, 2, 1)).describe(), "2 wood, 1 metal");
        a.add(&Bag::of(Mat::Metal, 3));
        assert_eq!(a.total(), 6);
    }

    #[test]
    fn pieces_are_unique() {
        for (i, d) in PIECES.iter().enumerate() {
            assert!(PIECES[i + 1..].iter().all(|o| o.kind != d.kind), "{} twice", d.kind);
        }
        assert!(piece("wall_log").is_some());
        assert_eq!(pave_cost("stone", 2.0), Some(Bag::new(0, 2, 0)));
        assert_eq!(pave_cost("lava", 2.0), None);
    }
}
