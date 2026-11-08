//! THE WIRE — what a client sends over its world's WebSocket (JSON text frames: `{"t": "...", "req": 7, ...}`), and
//! the binary pose frames both ways (little-endian). What the server sends as text is `world::Ev`.
//!
//! Pose, client → server:  [1u8] [n u8] n × ENTITY(32)
//! Poses, server → client: [2u8] [tick u32] [n u16] n × ([sid u32] ENTITY(32))
//! ENTITY: [slot u8] [kind u8] [flags u16] [x y z f32] [qx qy qz qw f32]
//!   slot 0 the player (what they control), 1 their car parked while on foot, 2 the trailer
//!   kind 0 on foot, 1 the jeep (G500), 2 the E30, 3 the motorbike, 4 the trailer
//!   flags bit 0: teleported (a rest at camp, a respawn — no speed check), bit 1: the trailer hitched

use serde::Deserialize;

use crate::catalog::{Bag, Mat};

#[derive(Deserialize, Debug)]
pub struct Envelope {
    /// Echoed in the answer (`ok` / `err`) so the client can match it.
    #[serde(default)]
    pub req: Option<u32>,
    #[serde(flatten)]
    pub msg: ClientMsg,
}

#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Store {
    /// In the player's hands.
    Carry,
    /// In the jeep's trailer.
    Trailer,
}

#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ShapeOp {
    Raise,
    Lower,
    Flatten,
    Smooth,
}

fn tree_h() -> f32 {
    16.0
}

#[derive(Deserialize, Debug)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum ClientMsg {
    Chat { text: String },
    /// A tree felled: its index in the map's tree list (the client's `Trees.data`), where it stood, how tall it was.
    CutTree { tree: u32, x: f32, z: f32, #[serde(default = "tree_h")] h: f32 },
    /// One hit on a rock or a scrap heap: `node` is the client's key ("rock:123", "scrap:mine"), `size` how much it holds.
    Mine { node: String, x: f32, z: f32, #[serde(default)] size: u32 },
    /// Pick up (as much as fits) a loose pile.
    Pick { drop: String, to: Store },
    /// Put something down on the ground.
    Drop { mat: Mat, qty: u32, from: Store, x: f32, y: f32, z: f32 },
    /// Into a claim's stockpile (anyone may give).
    Deposit { claim: String, from: Store, bag: Bag },
    /// Out of a claim's stockpile: the owner — or anyone while it isn't guarded (a raid).
    Take { claim: String, to: Store, bag: Bag },
    Claim { x: f32, z: f32, r: f32 },
    Unclaim { claim: String },
    Place { kind: String, x: f32, y: f32, z: f32, rot: f32, #[serde(default)] variant: u8 },
    /// A piece or a pond.
    Remove { piece: String },
    /// The ground under the brush (in your claim): `strength` m (raise / lower), 0–1 (flatten / smooth); flatten to `y`.
    Shape { op: ShapeOp, x: f32, z: f32, r: f32, #[serde(default = "one")] strength: f32, #[serde(default)] y: Option<f32> },
    /// Paint the ground: "stone", "gravel", "planks", "dirt", "erase".
    Pave { mat: String, x: f32, z: f32, r: f32 },
    /// Dig a pond and fill it.
    Pond { x: f32, z: f32, r: f32, #[serde(default = "one")] depth: f32 },
}

fn one() -> f32 {
    1.0
}

pub const ENTITY_BYTES: usize = 32;
pub const TAG_POSE: u8 = 1;
pub const TAG_POSES: u8 = 2;
pub const MAX_ENTITIES: usize = 3;
pub const FLAG_TELEPORT: u16 = 1;

pub const KIND_FOOT: u8 = 0;
pub const KIND_TRAILER: u8 = 4;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Entity {
    pub slot: u8,
    pub kind: u8,
    pub flags: u16,
    pub p: [f32; 3],
    pub q: [f32; 4],
}

fn f32_at(b: &[u8], o: usize) -> f32 {
    f32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}

/// A client's pose frame → its entities (None: malformed).
pub fn parse_pose(b: &[u8]) -> Option<Vec<Entity>> {
    if b.len() < 2 || b[0] != TAG_POSE {
        return None;
    }
    let n = b[1] as usize;
    if n > MAX_ENTITIES || b.len() != 2 + n * ENTITY_BYTES {
        return None;
    }
    let mut out = Vec::with_capacity(n);
    for k in 0..n {
        let o = 2 + k * ENTITY_BYTES;
        let e = Entity {
            slot: b[o],
            kind: b[o + 1],
            flags: u16::from_le_bytes([b[o + 2], b[o + 3]]),
            p: [f32_at(b, o + 4), f32_at(b, o + 8), f32_at(b, o + 12)],
            q: [f32_at(b, o + 16), f32_at(b, o + 20), f32_at(b, o + 24), f32_at(b, o + 28)],
        };
        if e.slot > 2 || e.kind > 4 || !e.p.iter().chain(e.q.iter()).all(|v| v.is_finite()) {
            return None;
        }
        if out.iter().any(|o: &Entity| o.slot == e.slot) {
            return None;
        }
        out.push(e);
    }
    Some(out)
}

pub fn write_entity(out: &mut Vec<u8>, e: &Entity) {
    out.push(e.slot);
    out.push(e.kind);
    out.extend_from_slice(&e.flags.to_le_bytes());
    for v in e.p.iter().chain(e.q.iter()) {
        out.extend_from_slice(&v.to_le_bytes());
    }
}

/// A client's pose frame (the tests' bots; the browser writes the same with a DataView).
pub fn pose_frame(ents: &[Entity]) -> Vec<u8> {
    let mut out = vec![TAG_POSE, ents.len() as u8];
    for e in ents {
        write_entity(&mut out, e);
    }
    out
}

/// The server's poses frame → (tick, [(sid, entity)]).
pub fn parse_poses(b: &[u8]) -> Option<(u32, Vec<(u32, Entity)>)> {
    if b.len() < 7 || b[0] != TAG_POSES {
        return None;
    }
    let tick = u32::from_le_bytes([b[1], b[2], b[3], b[4]]);
    let n = u16::from_le_bytes([b[5], b[6]]) as usize;
    if b.len() != 7 + n * (4 + ENTITY_BYTES) {
        return None;
    }
    let mut out = vec![];
    for k in 0..n {
        let o = 7 + k * (4 + ENTITY_BYTES);
        let sid = u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]);
        let mut f = vec![TAG_POSE, 1];
        f.extend_from_slice(&b[o + 4..o + 4 + ENTITY_BYTES]);
        out.push((sid, parse_pose(&f)?[0]));
    }
    Some((tick, out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pose_round_trip() {
        let e = Entity { slot: 0, kind: 1, flags: 2, p: [1.0, 2.0, -3.5], q: [0.0, 0.7, 0.0, 0.7] };
        let t = Entity { slot: 2, kind: KIND_TRAILER, flags: 0, p: [1.0, 2.0, -9.0], q: [0.0, 0.0, 0.0, 1.0] };
        let f = pose_frame(&[e, t]);
        assert_eq!(f.len(), 2 + 2 * ENTITY_BYTES);
        assert_eq!(parse_pose(&f), Some(vec![e, t]));
        assert_eq!(parse_pose(&f[..f.len() - 1]), None);
        let mut bad = f.clone();
        bad[2] = 9; // slot 9
        assert_eq!(parse_pose(&bad), None);
    }

    #[test]
    fn messages_parse() {
        let m: Envelope = serde_json::from_str(r#"{"t":"cut_tree","req":3,"tree":12,"x":1.5,"z":-2}"#).unwrap();
        assert_eq!(m.req, Some(3));
        assert!(matches!(m.msg, ClientMsg::CutTree { tree: 12, h, .. } if h == 16.0));
        let m: Envelope = serde_json::from_str(r#"{"t":"take","claim":"abc","to":"trailer","bag":{"stone":3}}"#).unwrap();
        assert!(matches!(m.msg, ClientMsg::Take { to: Store::Trailer, bag, .. } if bag.stone == 3 && bag.wood == 0));
        assert!(serde_json::from_str::<Envelope>(r#"{"t":"fly"}"#).is_err());
    }
}
