//! THE WIRE, by hand where it's hot: the POSES, 20 a second from every player (everything else: wire.rs, by the
//! schema in proto/wire.json). Little-endian.
//!
//! Pose, client → server:  [1u8] [n u8] n × ENTITY
//! Poses, server → client: [2u8] [tick u32] [p u8] p × ([sid u16] [n u8] n × ENTITY)   — only the players who moved
//!   since the last frame (a player's n entities replace what was known of them; a new arrival gets everyone's)
//! ENTITY (17 B): [meta u8] [x y z f32] [rotation u32]
//!   meta: slot (bits 0–1: 0 the player — what they control, 1 their car parked while they're on foot, 2 the trailer)
//!         | kind (bits 2–4: 0 on foot, 1 the jeep, 2 the E30, 3 the motorbike, 4 the trailer)
//!         | bit 5 teleported (no speed check) | bit 6 the trailer hitched
//!   rotation: the quaternion's "smallest three" — bits 30–31 which component is the largest (dropped, rebuilt from
//!   the others, sign made +), then the other three in order, 10 bits each over ±1/√2 (≈ 0.08° steps).
//!
//! The server relays each entity's 17 bytes as the client sent them: nothing re-encoded.

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

/// What a client asks for (proto/wire.json `intents`).
#[derive(Deserialize, Debug)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum ClientMsg {
    Chat { text: String },
    /// A tree felled: its index in the map's tree list (the client's `Trees.data`), where it stood, how tall it was.
    CutTree { tree: u32, x: f32, z: f32, h: f32 },
    /// One hit on a rock or a scrap heap: `node` is the client's key ("rock:123", "scrap:mine"), `size` how much it holds.
    Mine { node: String, x: f32, z: f32, size: u32 },
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
    Place { kind: String, x: f32, y: f32, z: f32, rot: f32, variant: u8 },
    /// A piece or a pond.
    Remove { piece: String },
    /// The ground under the brush (in your claim): `strength` m (raise / lower), 0–1 (flatten / smooth); flatten to `y`.
    Shape { op: ShapeOp, x: f32, z: f32, r: f32, strength: f32, y: Option<f32> },
    /// Paint the ground: "stone", "gravel", "planks", "dirt", "erase".
    Pave { mat: String, x: f32, z: f32, r: f32 },
    /// Dig a pond and fill it.
    Pond { x: f32, z: f32, r: f32, depth: f32 },
    /// The round trip: answered with `pong` at once.
    Ping { n: u32 },
    /// Your own things between your hands and your trailer (by it).
    Stow { from: Store, to: Store, bag: Bag },
}

pub const ENTITY_BYTES: usize = 17;
pub const TAG_POSE: u8 = 1;
pub const TAG_POSES: u8 = 2;
pub const MAX_ENTITIES: usize = 3;
pub const FLAG_TELEPORT: u16 = 1;
pub const FLAG_HITCHED: u16 = 2;

pub const KIND_FOOT: u8 = 0;
pub const KIND_TRAILER: u8 = 4;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Entity {
    pub slot: u8,
    pub kind: u8,
    pub flags: u16,
    pub p: [f32; 3],
    pub q: [f32; 4],
    /// The 17 bytes as they came (relayed as they are).
    pub raw: [u8; ENTITY_BYTES],
}

impl Entity {
    pub fn new(slot: u8, kind: u8, flags: u16, p: [f32; 3], q: [f32; 4]) -> Entity {
        let mut e = Entity { slot, kind, flags, p, q, raw: [0; ENTITY_BYTES] };
        e.raw[0] = (slot & 3) | ((kind & 7) << 2) | (((flags & FLAG_TELEPORT) as u8) << 5) | ((((flags & FLAG_HITCHED) >> 1) as u8) << 6);
        for (k, v) in p.iter().enumerate() {
            e.raw[1 + k * 4..5 + k * 4].copy_from_slice(&v.to_le_bytes());
        }
        e.raw[13..17].copy_from_slice(&pack_quat(q).to_le_bytes());
        e.q = unpack_quat(pack_quat(q));
        e
    }

    fn parse(raw: &[u8]) -> Option<Entity> {
        let raw: [u8; ENTITY_BYTES] = raw.try_into().ok()?;
        let m = raw[0];
        let (slot, kind) = (m & 3, (m >> 2) & 7);
        let flags = ((m >> 5) & 1) as u16 | (((m >> 6) & 1) as u16) << 1;
        let f = |o: usize| f32::from_le_bytes([raw[o], raw[o + 1], raw[o + 2], raw[o + 3]]);
        let p = [f(1), f(5), f(9)];
        if slot > 2 || kind > 4 || m & 0x80 != 0 || !p.iter().all(|v| v.is_finite() && v.abs() < 1e5) {
            return None;
        }
        let q = unpack_quat(u32::from_le_bytes([raw[13], raw[14], raw[15], raw[16]]));
        Some(Entity { slot, kind, flags, p, q, raw })
    }
}

const QK: f32 = 1023.0;

/// A quaternion → 32 bits (smallest three).
pub fn pack_quat(q: [f32; 4]) -> u32 {
    let n = (q.iter().map(|v| v * v).sum::<f32>()).sqrt().max(1e-9);
    let q = q.map(|v| v / n);
    let mut big = 0;
    for i in 1..4 {
        if q[i].abs() > q[big].abs() {
            big = i;
        }
    }
    let s = if q[big] < 0.0 { -1.0 } else { 1.0 };
    let mut out = (big as u32) << 30;
    let mut shift = 20;
    for (i, v) in q.iter().enumerate() {
        if i == big {
            continue;
        }
        let u = ((v * s * std::f32::consts::SQRT_2 + 1.0) * 0.5 * QK).round().clamp(0.0, QK) as u32;
        out |= u << shift;
        shift -= 10;
    }
    out
}

pub fn unpack_quat(w: u32) -> [f32; 4] {
    let big = (w >> 30) as usize;
    let mut q = [0.0f32; 4];
    let mut shift = 20;
    let mut sum = 0.0;
    for (i, c) in q.iter_mut().enumerate() {
        if i == big {
            continue;
        }
        let u = ((w >> shift) & 1023) as f32;
        *c = (u / QK * 2.0 - 1.0) / std::f32::consts::SQRT_2;
        sum += *c * *c;
        shift -= 10;
    }
    q[big] = (1.0 - sum).max(0.0).sqrt();
    q
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
    let mut out: Vec<Entity> = Vec::with_capacity(n);
    for k in 0..n {
        let e = Entity::parse(&b[2 + k * ENTITY_BYTES..2 + (k + 1) * ENTITY_BYTES])?;
        if out.iter().any(|o| o.slot == e.slot) {
            return None;
        }
        out.push(e);
    }
    Some(out)
}

/// A client's pose frame (the tests' bots; the browser writes the same — net/pose.ts).
pub fn pose_frame(ents: &[Entity]) -> Vec<u8> {
    let mut out = vec![TAG_POSE, ents.len() as u8];
    for e in ents {
        out.extend_from_slice(&e.raw);
    }
    out
}

/// The server's poses frame → (tick, [(sid, that player's entities)]).
/// The players in a poses frame: (session id, their entities).
pub type PosesFrame = Vec<(u16, Vec<Entity>)>;

pub fn parse_poses(b: &[u8]) -> Option<(u32, PosesFrame)> {
    if b.len() < 6 || b[0] != TAG_POSES {
        return None;
    }
    let tick = u32::from_le_bytes([b[1], b[2], b[3], b[4]]);
    let p = b[5] as usize;
    let mut o = 6;
    let mut out = vec![];
    for _ in 0..p {
        let sid = u16::from_le_bytes([*b.get(o)?, *b.get(o + 1)?]);
        let n = *b.get(o + 2)? as usize;
        o += 3;
        let mut ents = vec![];
        for _ in 0..n {
            ents.push(Entity::parse(b.get(o..o + ENTITY_BYTES)?)?);
            o += ENTITY_BYTES;
        }
        out.push((sid, ents));
    }
    (o == b.len()).then_some((tick, out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pose_round_trip() {
        let e = Entity::new(0, 1, FLAG_TELEPORT, [1.0, 2.0, -3.5], [0.0, std::f32::consts::FRAC_1_SQRT_2, 0.0, std::f32::consts::FRAC_1_SQRT_2]);
        let t = Entity::new(2, KIND_TRAILER, FLAG_HITCHED, [1.0, 2.0, -9.0], [0.0, 0.0, 0.0, 1.0]);
        let f = pose_frame(&[e, t]);
        assert_eq!(f.len(), 2 + 2 * ENTITY_BYTES);
        let back = parse_pose(&f).unwrap();
        assert_eq!(back, vec![e, t]);
        assert_eq!(back[0].flags, FLAG_TELEPORT);
        assert_eq!(back[1].flags, FLAG_HITCHED);
        assert_eq!(parse_pose(&f[..f.len() - 1]), None);
        let mut bad = f.clone();
        bad[2] = 3; // slot 3
        assert_eq!(parse_pose(&bad), None);
    }

    #[test]
    fn quaternions_survive() {
        let mut worst = 0.0f32;
        for k in 0..2000 {
            // (a spread of rotations: yaw, pitch, roll from a simple sequence)
            let (a, b, c) = (k as f32 * 0.37, k as f32 * 0.11, k as f32 * 0.05);
            let (sa, ca, sb, cb, sc, cc) = ((a / 2.0).sin(), (a / 2.0).cos(), (b / 2.0).sin(), (b / 2.0).cos(), (c / 2.0).sin(), (c / 2.0).cos());
            let q = [sc * cb * ca - cc * sb * sa, cc * sb * ca + sc * cb * sa, cc * cb * sa - sc * sb * ca, cc * cb * ca + sc * sb * sa];
            let r = unpack_quat(pack_quat(q));
            let dot = (q[0] * r[0] + q[1] * r[1] + q[2] * r[2] + q[3] * r[3]).abs().min(1.0);
            worst = worst.max(2.0 * dot.acos());
        }
        assert!(worst.to_degrees() < 0.25, "worst {}°", worst.to_degrees());
    }
}
