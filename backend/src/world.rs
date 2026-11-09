//! A LIVE WORLD — one task owns everything in it (docs/MULTIPLAYER.md §5): the players in it and their poses, and
//! the things that exist (claims and their stockpiles, pieces, loose piles, stumps, worked rocks, ponds, the ground's
//! edits, the paving, each player's hands and trailer). Clients send intents; the world checks them — near enough,
//! yours, paid for, not guarded — applies them, stores them (db.rs, write-behind) and tells everyone.
//!
//! THE GUARD (the user, 2026-11-08): "if we are in that territory others can't steal, else if we are out they can".
//! A claim is guarded while its owner is inside it (their pose within its circle + 2 m) — or, with the world's
//! `offline_guard` rule, while they're offline. Unguarded, anyone may take from its stockpile, pick up its loose
//! piles and fell its trees (a RAID: the owner is told). Buildings are never taken or destroyed.

use std::{
    cell::RefCell,
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicU32, Ordering},
    },
    time::{Duration, Instant},
};


use bytes::Bytes;
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, mpsc, oneshot};

use crate::{
    catalog::{self, Bag, CARRY_CAP, Mat, TRAILER_CAP},
    db::Db,
    map::{Ground, Maps},
    proto::{self, ClientMsg, Entity, Envelope, ShapeOp, Store},
    util::{finite, now_ms, rand_id},
    wire,
};

// ---- how far, how much

/// Reach on foot (m) — generous: the pose is up to a few frames old.
const HAND: f32 = 8.0;
/// The trailer's reach (m) from its own pose.
const TRAILER_REACH: f32 = 10.0;
/// How far from a claim's edge its owner may build (m) — the build camera looks from above.
const BUILD_REACH: f32 = 40.0;
/// Faster than this (m/s) without the teleport flag: the pose is ignored.
const MAX_SPEED: f32 = 90.0;
const MAX_PIECES: usize = 800;
const MAX_STROKES: usize = 3000;
const MAX_PONDS: usize = 4;
/// The ground may be raised / lowered this far (m) from the map's.
const MAX_EDIT: f32 = 8.0;
/// Messages a second (and the burst).
const MSG_RATE: f32 = 30.0;
const MSG_BURST: f32 = 60.0;
/// Poses: players within NEAR m of each other every tick (20 Hz); beyond, every FAR_EVERY ticks (5 Hz).
const NEAR: f32 = 300.0;
const FAR_EVERY: u32 = 4;

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(default)]
pub struct Rules {
    /// A claim stays guarded while its owner is offline.
    pub offline_guard: bool,
    /// A felled tree grows back after (min); not inside a claim.
    pub regrow_min: u32,
    /// A worked-out rock or scrap heap is back after (min).
    pub refill_min: u32,
    pub max_players: u32,
    pub claim_min_r: f32,
    pub claim_max_r: f32,
    pub claims_per_player: u32,
    /// A creative world: building costs nothing (trying the kit out; off by default).
    pub creative: bool,
}

impl Default for Rules {
    fn default() -> Rules {
        Rules {
            offline_guard: false,
            regrow_min: 120,
            refill_min: 60,
            max_players: 16,
            claim_min_r: 12.0,
            claim_max_r: 40.0,
            claims_per_player: 1,
            creative: false,
        }
    }
}

#[derive(Clone, Serialize, Debug)]
pub struct WorldInfo {
    pub id: String,
    pub code: String,
    pub name: String,
    pub map: String,
    pub owner: String,
    pub rules: Rules,
}

// ---- the things (as stored and as sent)

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Claim {
    pub id: String,
    pub owner: String,
    pub owner_name: String,
    pub x: f32,
    pub z: f32,
    pub r: f32,
    /// The ground's height at its centre (the flag's foot).
    pub y: f32,
    pub stock: Bag,
    pub created: u64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Piece {
    pub id: String,
    pub kind: String,
    pub owner: String,
    pub claim: String,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub rot: f32,
    pub variant: u8,
}

/// A loose pile on the ground (logs where a tree fell, what someone put down).
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Loose {
    pub id: String,
    pub mat: Mat,
    pub qty: u32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    /// The claim it lies in (guarded with it).
    pub claim: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Stump {
    pub tree: u32,
    pub x: f32,
    pub z: f32,
    pub at: u64,
    /// None: it stays cut (it stood in a claim).
    pub regrow_at: Option<u64>,
}

/// A rock or scrap heap being worked.
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Node {
    pub key: String,
    pub left: u32,
    pub max: u32,
    pub refill_at: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Pond {
    pub id: String,
    pub claim: String,
    pub x: f32,
    pub z: f32,
    pub r: f32,
    /// The water's surface (m).
    pub level: f32,
}

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
pub struct Inv {
    pub carry: Bag,
    pub trailer: Bag,
}

impl Inv {
    fn bag(&mut self, s: Store) -> &mut Bag {
        match s {
            Store::Carry => &mut self.carry,
            Store::Trailer => &mut self.trailer,
        }
    }
}

fn cap(s: Store) -> u32 {
    match s {
        Store::Carry => CARRY_CAP,
        Store::Trailer => TRAILER_CAP,
    }
}

/// A paving stroke.
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Stroke {
    pub mat: String,
    pub x: f32,
    pub z: f32,
    pub r: f32,
}

/// A claim's ground edits: grid cell (i, j) → the height's change (cm) from the map's.
type Cells = HashMap<(i32, i32), i32>;

fn cells_vec(c: &Cells) -> Vec<[i32; 3]> {
    c.iter().map(|(&(i, j), &d)| [i, j, d]).collect()
}

// ---- what goes out

#[derive(Serialize)]
pub struct PlayerView<'a> {
    pub sid: u32,
    pub id: &'a str,
    pub name: &'a str,
}

/// A stump as the clients see it (no clock).
#[derive(Serialize)]
pub struct StumpView {
    pub tree: u32,
    pub x: f32,
    pub z: f32,
}

#[derive(Serialize)]
pub struct NodeView<'a> {
    pub key: &'a str,
    pub left: u32,
}

#[derive(Serialize)]
pub struct StateView<'a> {
    pub players: Vec<PlayerView<'a>>,
    pub claims: Vec<&'a Claim>,
    pub guards: Vec<(&'a str, bool)>,
    pub cells: Vec<(&'a str, Vec<[i32; 3]>)>,
    pub paint: Vec<(&'a str, &'a Vec<Stroke>)>,
    pub pieces: Vec<&'a Piece>,
    pub drops: Vec<&'a Loose>,
    pub stumps: Vec<StumpView>,
    pub nodes: Vec<NodeView<'a>>,
    pub ponds: Vec<&'a Pond>,
}

#[derive(Serialize)]
#[serde(tag = "t", rename_all = "snake_case")]
#[allow(clippy::large_enum_variant)] // (made, serialised and dropped at once)
pub enum Ev<'a> {
    Welcome { you: PlayerView<'a>, world: &'a WorldInfo, state: StateView<'a>, inv: &'a Inv },
    Joined { sid: u32, id: &'a str, name: &'a str },
    Left { sid: u32 },
    Chat { sid: u32, name: &'a str, text: &'a str },
    TreeCut { tree: u32, x: f32, z: f32, by: u32 },
    TreeBack { tree: u32 },
    Drop { drop: &'a Loose },
    DropGone { id: &'a str },
    Node { key: &'a str, left: u32 },
    NodeBack { key: &'a str },
    Inv { inv: &'a Inv },
    Claim { claim: &'a Claim },
    ClaimGone { id: &'a str },
    Stock { claim: &'a str, stock: Bag },
    Guard { claim: &'a str, on: bool },
    Raid { claim: &'a str, owner: &'a str, by: u32, by_name: &'a str, bag: Bag },
    Piece { piece: &'a Piece },
    PieceGone { id: &'a str },
    Cells { claim: &'a str, cells: Vec<[i32; 3]> },
    Pave { claim: &'a str, stroke: &'a Stroke },
    Pond { pond: &'a Pond },
    PondGone { id: &'a str },
    Ok { req: u32 },
    Err { req: Option<u32>, msg: &'a str },
    Pong { n: u32 },
}

pub enum Out {
    /// An event (never dropped: a client that can't keep up is let go).
    Event(Bytes),
    /// A poses frame (dropped when the client's queue is full).
    Bin(Bytes),
    Close(String),
}

pub enum Cmd {
    Join { pid: String, name: String, tx: mpsc::Sender<Out>, reply: oneshot::Sender<Result<u32, String>> },
    Leave { sid: u32 },
    Msg { sid: u32, env: Envelope },
    Pose { sid: u32, ents: Vec<Entity> },
    /// (tests) everything the world holds, as JSON.
    #[allow(dead_code)]
    Dump { reply: oneshot::Sender<serde_json::Value> },
}

struct Member {
    pid: String,
    name: String,
    tx: mpsc::Sender<Out>,
    ents: Vec<Entity>,
    /// slot 0's last accepted pose: when, where.
    last: Option<(Instant, [f32; 3])>,
    budget: f32,
    budget_at: Instant,
    /// Its pose's version: one more for each pose taken (0: none yet).
    ver: u32,
    /// Each other player's `ver` last sent to this one.
    seen: HashMap<u32, u32>,
}

type R = Result<(), String>;

pub struct World {
    info: WorldInfo,
    db: Db,
    ground: Arc<Ground>,
    online: Arc<AtomicU32>,
    members: HashMap<u32, Member>,
    next_sid: u32,
    tick: u32,
    claims: HashMap<String, Claim>,
    cells: HashMap<String, Cells>,
    paint: HashMap<String, Vec<Stroke>>,
    pieces: HashMap<String, Piece>,
    drops: HashMap<String, Loose>,
    stumps: HashMap<u32, Stump>,
    nodes: HashMap<String, Node>,
    ponds: HashMap<String, Pond>,
    invs: HashMap<String, Inv>,
    /// The guard last told for each claim.
    guards: HashMap<String, bool>,
    /// Members whose queue overflowed or closed: dropped after the current command.
    kicks: RefCell<Vec<u32>>,
}

impl World {
    pub fn new(info: WorldInfo, rows: Vec<(String, String, String)>, db: Db, ground: Arc<Ground>) -> World {
        let mut w = World {
            info,
            db,
            ground,
            online: Arc::new(AtomicU32::new(0)),
            members: HashMap::new(),
            next_sid: 1,
            tick: 0,
            claims: HashMap::new(),
            cells: HashMap::new(),
            paint: HashMap::new(),
            pieces: HashMap::new(),
            drops: HashMap::new(),
            stumps: HashMap::new(),
            nodes: HashMap::new(),
            ponds: HashMap::new(),
            invs: HashMap::new(),
            guards: HashMap::new(),
            kicks: RefCell::new(vec![]),
        };
        for (kind, id, data) in rows {
            let ok = match kind.as_str() {
                "claim" => serde_json::from_str(&data).map(|c| { let _ = w.claims.insert(id.clone(), c); }),
                "cells" => serde_json::from_str::<Vec<[i32; 3]>>(&data).map(|v| { let _ = w.cells.insert(id.clone(), v.into_iter().map(|[i, j, d]| ((i, j), d)).collect()); }),
                "paint" => serde_json::from_str(&data).map(|v| { let _ = w.paint.insert(id.clone(), v); }),
                "piece" => serde_json::from_str(&data).map(|v| { let _ = w.pieces.insert(id.clone(), v); }),
                "drop" => serde_json::from_str(&data).map(|v| { let _ = w.drops.insert(id.clone(), v); }),
                "stump" => serde_json::from_str::<Stump>(&data).map(|v| { let _ = w.stumps.insert(v.tree, v); }),
                "node" => serde_json::from_str(&data).map(|v| { let _ = w.nodes.insert(id.clone(), v); }),
                "pond" => serde_json::from_str(&data).map(|v| { let _ = w.ponds.insert(id.clone(), v); }),
                "inv" => serde_json::from_str(&data).map(|v| { let _ = w.invs.insert(id.clone(), v); }),
                _ => Ok(()),
            };
            if let Err(e) = ok {
                tracing::warn!("world {}: bad {kind} row {id}: {e}", w.info.id);
            }
        }
        let ids: Vec<String> = w.claims.keys().cloned().collect();
        for id in ids {
            let g = w.guarded(&w.claims[&id]);
            w.guards.insert(id, g);
        }
        w
    }

    pub async fn run(mut self, mut rx: mpsc::Receiver<Cmd>) {
        let mut poses = tokio::time::interval(Duration::from_millis(50));
        poses.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut slow = tokio::time::interval(Duration::from_secs(5));
        loop {
            tokio::select! {
                cmd = rx.recv() => match cmd {
                    Some(c) => self.handle(c),
                    None => break,
                },
                _ = poses.tick() => self.send_poses(),
                _ = slow.tick() => self.regrow(now_ms()),
            }
            self.apply_kicks();
        }
    }

    // ---- members

    fn handle(&mut self, cmd: Cmd) {
        match cmd {
            Cmd::Join { pid, name, tx, reply } => {
                // (the same player again — a reload, a second tab: the old connection goes)
                let old: Vec<u32> = self.members.iter().filter(|(_, m)| m.pid == pid).map(|(s, _)| *s).collect();
                for s in old {
                    if let Some(m) = self.members.get(&s) {
                        let _ = m.tx.try_send(Out::Close("joined from somewhere else".into()));
                    }
                    self.leave(s);
                }
                if self.members.len() as u32 >= self.info.rules.max_players {
                    let _ = reply.send(Err("the world is full".into()));
                    return;
                }
                // (a session id fits in 16 bits on the wire: the next free one, round again after 65535)
                let mut sid = self.next_sid;
                while self.members.contains_key(&sid) {
                    sid = sid % 65535 + 1;
                }
                self.next_sid = sid % 65535 + 1;
                let now = Instant::now();
                self.members.insert(sid, Member { pid, name, tx, ents: vec![], last: None, budget: MSG_BURST, budget_at: now, ver: 0, seen: HashMap::new() });
                self.online.store(self.members.len() as u32, Ordering::Relaxed);
                let m = &self.members[&sid];
                let welcome = Ev::Welcome {
                    you: PlayerView { sid, id: &m.pid, name: &m.name },
                    world: &self.info,
                    state: self.state_view(),
                    inv: self.invs.get(&m.pid).unwrap_or(&EMPTY_INV),
                };
                self.to(sid, &welcome);
                let ev = Ev::Joined { sid, id: &m.pid, name: &m.name };
                self.others(sid, &ev);
                let _ = reply.send(Ok(sid));
                self.refresh_guards(None);
            }
            Cmd::Leave { sid } => self.leave(sid),
            Cmd::Pose { sid, ents } => self.pose(sid, ents),
            Cmd::Msg { sid, env } => {
                if !self.spend_budget(sid) {
                    self.to(sid, &Ev::Err { req: env.req, msg: "slow down" });
                    return;
                }
                match self.on_msg(sid, env.msg) {
                    Ok(()) => {
                        if let Some(req) = env.req {
                            self.to(sid, &Ev::Ok { req });
                        }
                    }
                    Err(msg) => self.to(sid, &Ev::Err { req: env.req, msg: &msg }),
                }
            }
            Cmd::Dump { reply } => {
                let _ = reply.send(serde_json::to_value(self.state_view()).unwrap_or_default());
            }
        }
    }

    fn leave(&mut self, sid: u32) {
        if self.members.remove(&sid).is_some() {
            self.online.store(self.members.len() as u32, Ordering::Relaxed);
            // (its session id may be given again: nobody remembers this one's poses)
            for m in self.members.values_mut() {
                m.seen.remove(&sid);
            }
            self.all(&Ev::Left { sid });
            self.refresh_guards(None);
        }
    }

    fn apply_kicks(&mut self) {
        loop {
            let k: Vec<u32> = self.kicks.borrow_mut().drain(..).collect();
            if k.is_empty() {
                return;
            }
            for sid in k {
                if let Some(m) = self.members.get(&sid) {
                    let _ = m.tx.try_send(Out::Close("too far behind".into()));
                }
                self.leave(sid);
            }
        }
    }

    fn spend_budget(&mut self, sid: u32) -> bool {
        let Some(m) = self.members.get_mut(&sid) else { return false };
        let now = Instant::now();
        m.budget = (m.budget + now.duration_since(m.budget_at).as_secs_f32() * MSG_RATE).min(MSG_BURST);
        m.budget_at = now;
        if m.budget < 1.0 {
            return false;
        }
        m.budget -= 1.0;
        true
    }

    fn state_view(&self) -> StateView<'_> {
        StateView {
            players: self.members.iter().map(|(s, m)| PlayerView { sid: *s, id: &m.pid, name: &m.name }).collect(),
            claims: self.claims.values().collect(),
            guards: self.guards.iter().map(|(k, v)| (k.as_str(), *v)).collect(),
            cells: self.cells.iter().map(|(k, c)| (k.as_str(), cells_vec(c))).collect(),
            paint: self.paint.iter().map(|(k, v)| (k.as_str(), v)).collect(),
            pieces: self.pieces.values().collect(),
            drops: self.drops.values().collect(),
            stumps: self.stumps.values().map(|s| StumpView { tree: s.tree, x: s.x, z: s.z }).collect(),
            nodes: self.nodes.values().map(|n| NodeView { key: &n.key, left: n.left }).collect(),
            ponds: self.ponds.values().collect(),
        }
    }

    // ---- sending

    fn send(&self, sid: u32, out: Out) {
        let Some(m) = self.members.get(&sid) else { return };
        match m.tx.try_send(out) {
            Ok(()) => {}
            // (a pose frame dropped is nothing: the next is 50 ms away — an event dropped would leave the client wrong)
            Err(mpsc::error::TrySendError::Full(Out::Bin(_))) => {}
            Err(_) => self.kicks.borrow_mut().push(sid),
        }
    }

    fn enc(ev: &Ev) -> Bytes {
        Bytes::from(wire::encode_ev(ev))
    }

    fn to(&self, sid: u32, ev: &Ev) {
        self.send(sid, Out::Event(Self::enc(ev)));
    }

    fn all(&self, ev: &Ev) {
        let t = Self::enc(ev);
        for sid in self.members.keys() {
            self.send(*sid, Out::Event(t.clone()));
        }
    }

    fn others(&self, not: u32, ev: &Ev) {
        let t = Self::enc(ev);
        for sid in self.members.keys().filter(|s| **s != not) {
            self.send(*sid, Out::Event(t.clone()));
        }
    }

    /// 20 a second, each player their own frame: every OTHER player whose pose changed since this one last heard of
    /// it — every tick within NEAR m, every FAR_EVERY ticks beyond (a far car is a few pixels; it still arrives where
    /// it stopped: what was last sent is remembered per player, `seen`). Nobody moved: no frame at all.
    fn send_poses(&mut self) {
        self.tick = self.tick.wrapping_add(1);
        let far_tick = self.tick.is_multiple_of(FAR_EVERY);
        let mut b: Vec<u8> = Vec::with_capacity(512);
        let sids: Vec<u32> = self.members.keys().copied().collect();
        for r in &sids {
            let me = self.ent(*r, 0).map(|e| e.p);
            b.clear();
            b.push(proto::TAG_POSES);
            b.extend_from_slice(&self.tick.to_le_bytes());
            b.push(0);
            let mut n = 0u8;
            let mut sent: Vec<(u32, u32)> = vec![];
            {
                let rm = &self.members[r];
                for (sid, m) in &self.members {
                    if sid == r || m.ver == 0 || rm.seen.get(sid) == Some(&m.ver) || n == 255 {
                        continue;
                    }
                    let near = match (me, m.ents.iter().find(|e| e.slot == 0)) {
                        (Some(a), Some(e)) => (a[0] - e.p[0]).hypot(a[2] - e.p[2]) < NEAR,
                        _ => true,
                    };
                    if !near && !far_tick && rm.seen.contains_key(sid) {
                        continue;
                    }
                    b.extend_from_slice(&(*sid as u16).to_le_bytes());
                    b.push(m.ents.len() as u8);
                    for e in &m.ents {
                        b.extend_from_slice(&e.raw);
                    }
                    n += 1;
                    sent.push((*sid, m.ver));
                }
            }
            if n == 0 {
                continue;
            }
            b[5] = n;
            self.send(*r, Out::Bin(Bytes::copy_from_slice(&b)));
            if let Some(rm) = self.members.get_mut(r) {
                rm.seen.extend(sent);
            }
        }
    }

    // ---- storing

    fn put<T: Serialize>(&self, kind: &'static str, id: &str, v: &T) {
        self.db.put(&self.info.id, kind, id, serde_json::to_string(v).expect("thing"));
    }

    fn del(&self, kind: &'static str, id: &str) {
        self.db.del(&self.info.id, kind, id);
    }

    // ---- where things are

    fn pid(&self, sid: u32) -> &str {
        self.members.get(&sid).map(|m| m.pid.as_str()).unwrap_or("")
    }

    fn ent(&self, sid: u32, slot: u8) -> Option<&Entity> {
        self.members.get(&sid)?.ents.iter().find(|e| e.slot == slot)
    }

    fn near(&self, sid: u32, x: f32, z: f32, reach: f32) -> R {
        let Some(e) = self.ent(sid, 0) else { return Err("where are you? (no position yet)".into()) };
        if (e.p[0] - x).hypot(e.p[2] - z) <= reach { Ok(()) } else { Err("too far away".into()) }
    }

    fn trailer_near(&self, sid: u32, x: f32, z: f32, reach: f32) -> R {
        let Some(e) = self.ent(sid, 2).filter(|e| e.kind == proto::KIND_TRAILER) else { return Err("no trailer".into()) };
        if (e.p[0] - x).hypot(e.p[2] - z) <= reach { Ok(()) } else { Err("the trailer is too far away".into()) }
    }

    fn store_near(&self, sid: u32, s: Store, x: f32, z: f32, extra: f32) -> R {
        match s {
            Store::Carry => self.near(sid, x, z, HAND + extra),
            Store::Trailer => self.trailer_near(sid, x, z, TRAILER_REACH + extra),
        }
    }

    /// The claim (x, z) lies in.
    fn claim_at(&self, x: f32, z: f32) -> Option<&Claim> {
        self.claims.values().find(|c| (c.x - x).hypot(c.z - z) <= c.r)
    }

    /// The claim of `sid`'s at (x, z) — else why not.
    fn own_claim_at(&self, sid: u32, x: f32, z: f32) -> Result<Claim, String> {
        match self.claim_at(x, z) {
            Some(c) if c.owner == self.pid(sid) => Ok(c.clone()),
            Some(c) => Err(format!("that's {}'s land", c.owner_name)),
            None => Err("that's not in your land — claim it first".into()),
        }
    }

    fn owner_online(&self, pid: &str) -> Option<u32> {
        self.members.iter().find(|(_, m)| m.pid == pid).map(|(s, _)| *s)
    }

    fn guarded(&self, c: &Claim) -> bool {
        match self.owner_online(&c.owner) {
            Some(sid) => self.ent(sid, 0).is_some_and(|e| (e.p[0] - c.x).hypot(e.p[2] - c.z) <= c.r + 2.0),
            None => self.info.rules.offline_guard,
        }
    }

    /// `sid` may take from claim `cid` (theirs, or unguarded).
    fn may_take(&self, sid: u32, cid: &str) -> R {
        let Some(c) = self.claims.get(cid) else { return Ok(()) };
        if c.owner == self.pid(sid) || !self.guarded(c) {
            Ok(())
        } else {
            Err(format!("{} is home — their land is guarded", c.owner_name))
        }
    }

    /// Tells everyone a raid happened if `sid` took `bag` from someone else's claim.
    fn raid(&self, sid: u32, cid: Option<&str>, bag: Bag) {
        let Some(c) = cid.and_then(|id| self.claims.get(id)) else { return };
        if c.owner == self.pid(sid) || bag.is_empty() {
            return;
        }
        let by_name = self.members.get(&sid).map(|m| m.name.as_str()).unwrap_or("");
        self.all(&Ev::Raid { claim: &c.id, owner: &c.owner, by: sid, by_name, bag });
    }

    /// Re-works the guards (all, or `owner`'s claims) and tells the changes.
    fn refresh_guards(&mut self, owner: Option<&str>) {
        let changed: Vec<(String, bool)> = self
            .claims
            .values()
            .filter(|c| owner.is_none_or(|o| c.owner == o))
            .filter_map(|c| {
                let g = self.guarded(c);
                (self.guards.get(&c.id) != Some(&g)).then(|| (c.id.clone(), g))
            })
            .collect();
        for (id, g) in changed {
            self.all(&Ev::Guard { claim: &id, on: g });
            self.guards.insert(id, g);
        }
    }

    fn pose(&mut self, sid: u32, ents: Vec<Entity>) {
        let Some(m) = self.members.get_mut(&sid) else { return };
        let now = Instant::now();
        if let Some(e) = ents.iter().find(|e| e.slot == 0) {
            if let Some((t, p)) = m.last {
                let dt = now.duration_since(t).as_secs_f32().max(0.05);
                let d = (e.p[0] - p[0]).hypot(e.p[2] - p[2]);
                if e.flags & proto::FLAG_TELEPORT == 0 && d > MAX_SPEED * dt + 5.0 {
                    return; // (a jump the car can't make: ignored — the next real pose goes through)
                }
            }
            m.last = Some((now, e.p));
        }
        m.ents = ents;
        m.ver = m.ver.wrapping_add(1);
        let pid = m.pid.clone();
        if self.claims.values().any(|c| c.owner == pid) {
            self.refresh_guards(Some(&pid));
        }
    }

    // ---- the world's clock: trees regrow, rocks refill

    fn regrow(&mut self, now: u64) {
        let back: Vec<u32> = self.stumps.values().filter(|s| s.regrow_at.is_some_and(|t| t <= now)).map(|s| s.tree).collect();
        for tree in back {
            let s = &self.stumps[&tree];
            if self.claim_at(s.x, s.z).is_some() {
                // (claimed since it fell: it stays a stump)
                let mut s = s.clone();
                s.regrow_at = None;
                self.put("stump", &tree.to_string(), &s);
                self.stumps.insert(tree, s);
                continue;
            }
            self.stumps.remove(&tree);
            self.del("stump", &tree.to_string());
            self.all(&Ev::TreeBack { tree });
        }
        let refill: Vec<String> = self.nodes.values().filter(|n| n.refill_at.is_some_and(|t| t <= now)).map(|n| n.key.clone()).collect();
        for key in refill {
            self.nodes.remove(&key);
            self.del("node", &key);
            self.all(&Ev::NodeBack { key: &key });
        }
    }

    // ---- intents

    fn on_msg(&mut self, sid: u32, msg: ClientMsg) -> R {
        match msg {
            ClientMsg::Chat { text } => {
                let Some(text) = crate::util::clean_name(&text, 200) else { return Err("say something".into()) };
                let name = self.members.get(&sid).map(|m| m.name.as_str()).unwrap_or("");
                self.all(&Ev::Chat { sid, name, text: &text });
                Ok(())
            }
            ClientMsg::CutTree { tree, x, z, h } => self.cut_tree(sid, tree, x, z, h),
            ClientMsg::Mine { node, x, z, size } => self.mine(sid, node, x, z, size),
            ClientMsg::Pick { drop, to } => self.pick(sid, &drop, to),
            ClientMsg::Drop { mat, qty, from, x, y, z } => self.put_down(sid, mat, qty, from, x, y, z),
            ClientMsg::Deposit { claim, from, bag } => self.deposit(sid, &claim, from, bag),
            ClientMsg::Take { claim, to, bag } => self.take(sid, &claim, to, bag),
            ClientMsg::Claim { x, z, r } => self.claim(sid, x, z, r),
            ClientMsg::Unclaim { claim } => self.unclaim(sid, &claim),
            ClientMsg::Place { kind, x, y, z, rot, variant } => self.place(sid, &kind, x, y, z, rot, variant),
            ClientMsg::Remove { piece } => self.remove(sid, &piece),
            ClientMsg::Shape { op, x, z, r, strength, y } => self.shape(sid, op, x, z, r, strength, y),
            ClientMsg::Pave { mat, x, z, r } => self.pave(sid, mat, x, z, r),
            ClientMsg::Pond { x, z, r, depth } => self.pond(sid, x, z, r, depth),
            ClientMsg::Stow { from, to, bag } => self.stow(sid, from, to, bag),
            ClientMsg::Ping { n } => {
                self.to(sid, &Ev::Pong { n });
                Ok(())
            }
        }
    }

    fn inv_mut(&mut self, sid: u32) -> (String, &mut Inv) {
        let pid = self.pid(sid).to_string();
        let inv = self.invs.entry(pid.clone()).or_default();
        (pid, inv)
    }

    fn inv_changed(&self, sid: u32) {
        let pid = self.pid(sid);
        if let Some(inv) = self.invs.get(pid) {
            self.put("inv", pid, inv);
            self.to(sid, &Ev::Inv { inv });
        }
    }

    /// A loose pile at (x, y, z) — merged into one of the same within 1.5 m.
    fn spawn_drop(&mut self, mat: Mat, qty: u32, x: f32, y: f32, z: f32) {
        let claim = self.claim_at(x, z).map(|c| c.id.clone());
        let near = self.drops.values_mut().find(|d| d.mat == mat && d.claim == claim && (d.x - x).hypot(d.z - z) < 1.5);
        let d = match near {
            Some(d) => {
                d.qty = d.qty.saturating_add(qty);
                d.clone()
            }
            None => {
                let d = Loose { id: rand_id(10), mat, qty, x, y, z, claim };
                self.drops.insert(d.id.clone(), d.clone());
                d
            }
        };
        self.put("drop", &d.id, &d);
        self.all(&Ev::Drop { drop: &d });
    }

    fn cut_tree(&mut self, sid: u32, tree: u32, x: f32, z: f32, h: f32) -> R {
        if !finite(&[x, z, h]) {
            return Err("bad tree".into());
        }
        if self.stumps.contains_key(&tree) {
            return Err("that tree is already down".into());
        }
        self.near(sid, x, z, HAND)?;
        let claim = self.claim_at(x, z).map(|c| c.id.clone());
        if let Some(c) = &claim {
            self.may_take(sid, c)?;
        }
        let now = now_ms();
        let regrow_at = claim.is_none().then(|| now + self.info.rules.regrow_min as u64 * 60_000);
        let s = Stump { tree, x, z, at: now, regrow_at };
        self.put("stump", &tree.to_string(), &s);
        self.stumps.insert(tree, s);
        self.all(&Ev::TreeCut { tree, x, z, by: sid });
        let wood = ((h / 4.0).round() as u32).clamp(2, 6);
        self.raid(sid, claim.as_deref(), Bag::of(Mat::Wood, wood));
        let y = self.ground.height(x, z) + 0.3;
        self.spawn_drop(Mat::Wood, wood, x, y, z);
        Ok(())
    }

    fn mine(&mut self, sid: u32, key: String, x: f32, z: f32, size: u32) -> R {
        if !finite(&[x, z]) || key.is_empty() || key.len() > 40 || !key.chars().all(|c| c.is_ascii_alphanumeric() || ":_-".contains(c)) {
            return Err("bad rock".into());
        }
        self.near(sid, x, z, HAND)?;
        let claim = self.claim_at(x, z).map(|c| c.id.clone());
        if let Some(c) = &claim {
            self.may_take(sid, c)?;
        }
        let max = if size == 0 { 4 } else { size.min(12) };
        let left = self.nodes.get(&key).map_or(max, |n| n.left);
        if left == 0 {
            return Err("nothing left here".into());
        }
        let mat = if key.starts_with("scrap") { Mat::Metal } else { Mat::Stone };
        let (_, inv) = self.inv_mut(sid);
        if inv.carry.total() >= CARRY_CAP {
            return Err("your hands are full".into());
        }
        *inv.carry.get_mut(mat) += 1;
        let refill_at = (left == 1).then(|| now_ms() + self.info.rules.refill_min as u64 * 60_000);
        let n = Node { key: key.clone(), left: left - 1, max: self.nodes.get(&key).map_or(max, |n| n.max), refill_at };
        self.put("node", &key, &n);
        self.nodes.insert(key.clone(), n);
        self.all(&Ev::Node { key: &key, left: left - 1 });
        self.inv_changed(sid);
        self.raid(sid, claim.as_deref(), Bag::of(mat, 1));
        Ok(())
    }

    fn pick(&mut self, sid: u32, id: &str, to: Store) -> R {
        let d = self.drops.get(id).cloned().ok_or("it's gone")?;
        self.store_near(sid, to, d.x, d.z, 0.0)?;
        if let Some(c) = &d.claim {
            self.may_take(sid, c)?;
        }
        let (_, inv) = self.inv_mut(sid);
        let room = cap(to).saturating_sub(inv.bag(to).total());
        if room == 0 {
            return Err(if to == Store::Carry { "your hands are full".into() } else { "the trailer is full".into() });
        }
        let q = room.min(d.qty);
        inv.bag(to).add(&Bag::of(d.mat, q));
        self.inv_changed(sid);
        let left = d.qty - q;
        if left == 0 {
            self.drops.remove(id);
            self.del("drop", id);
            self.all(&Ev::DropGone { id });
        } else {
            let d2 = Loose { qty: left, ..d.clone() };
            self.put("drop", id, &d2);
            self.all(&Ev::Drop { drop: &d2 });
            self.drops.insert(id.to_string(), d2);
        }
        self.raid(sid, d.claim.as_deref(), Bag::of(d.mat, q));
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn put_down(&mut self, sid: u32, mat: Mat, qty: u32, from: Store, x: f32, y: f32, z: f32) -> R {
        if !finite(&[x, y, z]) || qty == 0 {
            return Err("bad drop".into());
        }
        self.store_near(sid, from, x, z, 0.0)?;
        let (_, inv) = self.inv_mut(sid);
        if !inv.bag(from).take(&Bag::of(mat, qty)) {
            return Err(format!("you don't have {qty} {}", catalog::mat_name(mat)));
        }
        self.inv_changed(sid);
        let y = y.clamp(self.ground.height(x, z) - 1.0, self.ground.height(x, z) + 30.0);
        self.spawn_drop(mat, qty, x, y, z);
        Ok(())
    }

    /// Your own things between your hands and your trailer — by the trailer (within 6 m of it).
    fn stow(&mut self, sid: u32, from: Store, to: Store, bag: Bag) -> R {
        if from == to || bag.is_empty() {
            return Err("nothing to move".into());
        }
        let p = self.ent(sid, 0).map(|e| e.p).ok_or("where are you? (no position yet)")?;
        self.trailer_near(sid, p[0], p[2], 6.0)?;
        let (_, inv) = self.inv_mut(sid);
        if inv.bag(to).total() + bag.total() > cap(to) {
            return Err(if to == Store::Carry { "you can't carry that much".into() } else { "that won't fit in the trailer".into() });
        }
        if !inv.bag(from).take(&bag) {
            return Err(format!("you don't have {}", bag.describe()));
        }
        inv.bag(to).add(&bag);
        self.inv_changed(sid);
        Ok(())
    }

    fn deposit(&mut self, sid: u32, cid: &str, from: Store, bag: Bag) -> R {
        let c = self.claims.get(cid).cloned().ok_or("no such land")?;
        if bag.is_empty() {
            return Err("nothing to put in".into());
        }
        self.store_near(sid, from, c.x, c.z, c.r)?;
        let (_, inv) = self.inv_mut(sid);
        if !inv.bag(from).take(&bag) {
            return Err(format!("you don't have {}", bag.describe()));
        }
        self.inv_changed(sid);
        let c = self.claims.get_mut(cid).expect("claim");
        c.stock.add(&bag);
        let (stock, c) = (c.stock, c.clone());
        self.put("claim", cid, &c);
        self.all(&Ev::Stock { claim: cid, stock });
        Ok(())
    }

    fn take(&mut self, sid: u32, cid: &str, to: Store, bag: Bag) -> R {
        let c = self.claims.get(cid).cloned().ok_or("no such land")?;
        if bag.is_empty() {
            return Err("nothing to take".into());
        }
        self.store_near(sid, to, c.x, c.z, c.r)?;
        self.may_take(sid, cid)?;
        if !c.stock.covers(&bag) {
            return Err(if c.stock.is_empty() { "the stockpile is empty".into() } else { format!("there's only {}", c.stock.describe()) });
        }
        let (_, inv) = self.inv_mut(sid);
        if inv.bag(to).total() + bag.total() > cap(to) {
            return Err(if to == Store::Carry { "you can't carry that much".into() } else { "that won't fit in the trailer".into() });
        }
        inv.bag(to).add(&bag);
        self.inv_changed(sid);
        let c = self.claims.get_mut(cid).expect("claim");
        c.stock.take(&bag);
        let (stock, c) = (c.stock, c.clone());
        self.put("claim", cid, &c);
        self.all(&Ev::Stock { claim: cid, stock });
        self.raid(sid, Some(cid), bag);
        Ok(())
    }

    fn claim(&mut self, sid: u32, x: f32, z: f32, r: f32) -> R {
        let rules = &self.info.rules;
        if !finite(&[x, z, r]) || r < rules.claim_min_r || r > rules.claim_max_r {
            return Err(format!("land is {}–{} m across", rules.claim_min_r * 2.0, rules.claim_max_r * 2.0));
        }
        let half = self.ground.half();
        if x.abs() > half - r || z.abs() > half - r {
            return Err("too close to the edge of the world".into());
        }
        self.near(sid, x, z, r + 30.0)?;
        let pid = self.pid(sid).to_string();
        if self.claims.values().filter(|c| c.owner == pid).count() as u32 >= rules.claims_per_player {
            return Err("you already have land".into());
        }
        if let Some(o) = self.claims.values().find(|c| (c.x - x).hypot(c.z - z) < c.r + r + 4.0) {
            return Err(format!("too close to {}'s land", o.owner_name));
        }
        let owner_name = self.members.get(&sid).map(|m| m.name.clone()).unwrap_or_default();
        let c = Claim { id: rand_id(10), owner: pid, owner_name, x, z, r, y: self.ground.height(x, z), stock: Bag::default(), created: now_ms() };
        self.put("claim", &c.id, &c);
        self.all(&Ev::Claim { claim: &c });
        // (loose piles already lying there are in it now)
        let inside: Vec<String> = self.drops.values().filter(|d| (d.x - x).hypot(d.z - z) <= r).map(|d| d.id.clone()).collect();
        self.claims.insert(c.id.clone(), c.clone());
        for id in inside {
            let d = self.drops.get_mut(&id).expect("drop");
            d.claim = Some(c.id.clone());
            let d = d.clone();
            self.put("drop", &id, &d);
            self.all(&Ev::Drop { drop: &d });
        }
        self.refresh_guards(Some(&c.owner));
        Ok(())
    }

    fn unclaim(&mut self, sid: u32, cid: &str) -> R {
        let c = self.claims.get(cid).cloned().ok_or("no such land")?;
        if c.owner != self.pid(sid) {
            return Err("that isn't yours".into());
        }
        if self.pieces.values().any(|p| p.claim == cid) {
            return Err("take the buildings down first".into());
        }
        self.claims.remove(cid);
        self.guards.remove(cid);
        self.del("claim", cid);
        if self.cells.remove(cid).is_some() {
            self.del("cells", cid);
        }
        if self.paint.remove(cid).is_some() {
            self.del("paint", cid);
        }
        let ponds: Vec<String> = self.ponds.values().filter(|p| p.claim == cid).map(|p| p.id.clone()).collect();
        for id in ponds {
            self.ponds.remove(&id);
            self.del("pond", &id);
        }
        self.all(&Ev::ClaimGone { id: cid });
        // (its loose piles lie free; the stockpile is left on the ground)
        let free: Vec<String> = self.drops.values().filter(|d| d.claim.as_deref() == Some(cid)).map(|d| d.id.clone()).collect();
        for id in free {
            let d = self.drops.get_mut(&id).expect("drop");
            d.claim = None;
            let d = d.clone();
            self.put("drop", &id, &d);
            self.all(&Ev::Drop { drop: &d });
        }
        for m in catalog::MATS {
            let n = c.stock.get(m);
            if n > 0 {
                self.spawn_drop(m, n, c.x + 1.5 * (m as i32 as f32 - 1.0), c.y + 0.3, c.z + 2.0);
            }
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn place(&mut self, sid: u32, kind: &str, x: f32, y: f32, z: f32, rot: f32, variant: u8) -> R {
        let def = catalog::piece(kind).ok_or("no such piece")?;
        if !finite(&[x, y, z, rot]) {
            return Err("bad place".into());
        }
        let c = self.own_claim_at(sid, x, z)?;
        self.near(sid, c.x, c.z, c.r + BUILD_REACH)?;
        let g = self.ground.height(x, z) + self.edit_at(&c.id, x, z);
        if y < g - 6.0 || y > g + 30.0 {
            return Err("that's not on the ground".into());
        }
        if self.pieces.values().filter(|p| p.claim == c.id).count() >= MAX_PIECES {
            return Err("your land is full".into());
        }
        let creative = self.info.rules.creative;
        let cl = self.claims.get_mut(&c.id).expect("claim");
        if !creative && !cl.stock.take(&def.cost) {
            return Err(format!("you need {} more in your stockpile", cl.stock.short_of(&def.cost).describe()));
        }
        let (stock, cl) = (cl.stock, cl.clone());
        self.put("claim", &c.id, &cl);
        let p = Piece { id: rand_id(10), kind: kind.into(), owner: c.owner.clone(), claim: c.id.clone(), x, y, z, rot, variant };
        self.put("piece", &p.id, &p);
        self.all(&Ev::Piece { piece: &p });
        self.all(&Ev::Stock { claim: &c.id, stock });
        self.pieces.insert(p.id.clone(), p);
        Ok(())
    }

    fn remove(&mut self, sid: u32, id: &str) -> R {
        if let Some(p) = self.ponds.get(id).cloned() {
            let c = self.claims.get(&p.claim).ok_or("no such land")?;
            if c.owner != self.pid(sid) {
                return Err("that isn't yours".into());
            }
            self.ponds.remove(id);
            self.del("pond", id);
            self.all(&Ev::PondGone { id });
            return Ok(());
        }
        let p = self.pieces.get(id).cloned().ok_or("it's gone")?;
        if p.owner != self.pid(sid) {
            return Err("that isn't yours".into());
        }
        self.pieces.remove(id);
        self.del("piece", id);
        self.all(&Ev::PieceGone { id });
        let refund = catalog::piece(&p.kind).map(|d| d.cost.half()).unwrap_or_default();
        if let Some(c) = self.claims.get_mut(&p.claim) {
            c.stock.add(&refund);
            let (stock, c) = (c.stock, c.clone());
            self.put("claim", &c.id, &c);
            self.all(&Ev::Stock { claim: &c.id, stock });
        }
        Ok(())
    }

    // ---- the ground

    /// The edit (m) at (x, z) in claim `cid` (bilinear over its cells).
    fn edit_at(&self, cid: &str, x: f32, z: f32) -> f32 {
        let Some(cells) = self.cells.get(cid) else { return 0.0 };
        let g = &self.ground;
        let fx = (x - g.origin) / g.step;
        let fz = (z - g.origin) / g.step;
        let (i, j) = (fx.floor() as i32, fz.floor() as i32);
        let (tx, tz) = (fx - i as f32, fz - j as f32);
        let d = |i, j| *cells.get(&(i, j)).unwrap_or(&0) as f32 / 100.0;
        let a = d(i, j) + (d(i + 1, j) - d(i, j)) * tx;
        let b = d(i, j + 1) + (d(i + 1, j + 1) - d(i, j + 1)) * tx;
        a + (b - a) * tz
    }

    /// Changes the ground of claim `c` under a brush at (x, z) of radius r: `f(cell's height now, weight 0–1, the
    /// cell) → its new height`. Only cells inside the claim change. Sends and stores the changed cells.
    fn edit_ground(&mut self, c: &Claim, x: f32, z: f32, r: f32, f: impl Fn(f32, f32, (i32, i32), &dyn Fn(i32, i32) -> f32) -> f32) {
        let g = self.ground.clone();
        let (i0, j0) = g.cell_of(x - r, z - r);
        let (i1, j1) = g.cell_of(x + r, z + r);
        let cells = self.cells.entry(c.id.clone()).or_default();
        let snapshot = cells.clone();
        let now_h = |i: i32, j: i32| g.base(i, j) + *snapshot.get(&(i, j)).unwrap_or(&0) as f32 / 100.0;
        let mut changed = vec![];
        for j in j0..=j1 {
            for i in i0..=i1 {
                let (cx, cz) = g.cell_pos(i, j);
                let t = (cx - x).hypot(cz - z) / r;
                if t > 1.0 || (cx - c.x).hypot(cz - c.z) > c.r {
                    continue;
                }
                // (full strength inside half the radius, easing to nothing at the rim)
                let s = ((t - 0.5) / 0.5).clamp(0.0, 1.0);
                let w = 1.0 - s * s * (3.0 - 2.0 * s);
                let h = now_h(i, j);
                let nh = f(h, w, (i, j), &now_h);
                let d = ((nh - g.base(i, j)).clamp(-MAX_EDIT, MAX_EDIT) * 100.0).round() as i32;
                if d != *snapshot.get(&(i, j)).unwrap_or(&0) {
                    if d == 0 {
                        cells.remove(&(i, j));
                    } else {
                        cells.insert((i, j), d);
                    }
                    changed.push([i, j, d]);
                }
            }
        }
        if changed.is_empty() {
            return;
        }
        let v = cells_vec(cells);
        self.put("cells", &c.id, &v);
        self.all(&Ev::Cells { claim: &c.id, cells: changed });
    }

    #[allow(clippy::too_many_arguments)]
    fn shape(&mut self, sid: u32, op: ShapeOp, x: f32, z: f32, r: f32, strength: f32, y: Option<f32>) -> R {
        if !finite(&[x, z, r, strength]) || !(1.0..=12.0).contains(&r) {
            return Err("the brush is 2–24 m across".into());
        }
        let c = self.own_claim_at(sid, x, z)?;
        self.near(sid, c.x, c.z, c.r + BUILD_REACH)?;
        match op {
            ShapeOp::Raise | ShapeOp::Lower => {
                let k = strength.clamp(0.0, 2.0) * if op == ShapeOp::Raise { 1.0 } else { -1.0 };
                self.edit_ground(&c, x, z, r, |h, w, _, _| h + k * w);
            }
            ShapeOp::Flatten => {
                let target = y.filter(|v| v.is_finite()).ok_or("flatten to what height?")?;
                let k = strength.clamp(0.0, 1.0);
                self.edit_ground(&c, x, z, r, |h, w, _, _| h + (target - h) * w * k);
            }
            ShapeOp::Smooth => {
                let k = strength.clamp(0.0, 1.0) * 0.5;
                self.edit_ground(&c, x, z, r, |h, w, (i, j), now| {
                    let avg = (now(i - 1, j) + now(i + 1, j) + now(i, j - 1) + now(i, j + 1)) * 0.25;
                    h + (avg - h) * w * k
                });
            }
        }
        Ok(())
    }

    fn pave(&mut self, sid: u32, mat: String, x: f32, z: f32, r: f32) -> R {
        if !finite(&[x, z, r]) || !(0.5..=6.0).contains(&r) {
            return Err("the brush is 1–12 m across".into());
        }
        let cost = catalog::pave_cost(&mat, r).ok_or("no such paving")?;
        let c = self.own_claim_at(sid, x, z)?;
        self.near(sid, c.x, c.z, c.r + BUILD_REACH)?;
        if self.paint.get(&c.id).is_some_and(|v| v.len() >= MAX_STROKES) {
            return Err("that's a lot of paving — no more here".into());
        }
        let creative = self.info.rules.creative;
        let cl = self.claims.get_mut(&c.id).expect("claim");
        if !creative && !cl.stock.take(&cost) {
            return Err(format!("you need {} more in your stockpile", cl.stock.short_of(&cost).describe()));
        }
        let (stock, cl) = (cl.stock, cl.clone());
        self.put("claim", &c.id, &cl);
        let s = Stroke { mat, x, z, r };
        let v = self.paint.entry(c.id.clone()).or_default();
        v.push(s.clone());
        let v = v.clone();
        self.put("paint", &c.id, &v);
        self.all(&Ev::Pave { claim: &c.id, stroke: &s });
        if !cost.is_empty() {
            self.all(&Ev::Stock { claim: &c.id, stock });
        }
        Ok(())
    }

    fn pond(&mut self, sid: u32, x: f32, z: f32, r: f32, depth: f32) -> R {
        if !finite(&[x, z, r, depth]) || !(3.0..=15.0).contains(&r) {
            return Err("a pond is 6–30 m across".into());
        }
        let c = self.own_claim_at(sid, x, z)?;
        if (x - c.x).hypot(z - c.z) + r > c.r {
            return Err("the pond must be inside your land".into());
        }
        self.near(sid, c.x, c.z, c.r + BUILD_REACH)?;
        if self.ponds.values().filter(|p| p.claim == c.id).count() >= MAX_PONDS {
            return Err("that's enough ponds".into());
        }
        let depth = depth.clamp(0.5, 3.0);
        // (the water stands just under the lowest point of the rim — on a slope that's the downhill side)
        let mut rim = f32::INFINITY;
        for k in 0..32 {
            let a = k as f32 / 32.0 * std::f32::consts::TAU;
            let (px, pz) = (x + a.cos() * r, z + a.sin() * r);
            rim = rim.min(self.ground.height(px, pz) + self.edit_at(&c.id, px, pz));
        }
        let level = rim - 0.25;
        // (a BOWL under that level: deepest in the middle, its floor easing up to the waterline at the rim — dug down to
        //  it wherever the ground stands higher, a steep bank on the uphill side; never raised)
        let g = self.ground.clone();
        self.edit_ground(&c, x, z, r, |h, _, (i, j), _| {
            let (cx, cz) = g.cell_pos(i, j);
            let t = (cx - x).hypot(cz - z) / r;
            if t >= 1.0 {
                return h;
            }
            h.min(level - depth * (1.0 - t * t))
        });
        let p = Pond { id: rand_id(10), claim: c.id.clone(), x, z, r, level };
        self.put("pond", &p.id, &p);
        self.all(&Ev::Pond { pond: &p });
        self.ponds.insert(p.id.clone(), p);
        Ok(())
    }
}

static EMPTY_INV: Inv = Inv { carry: Bag::new(0, 0, 0), trailer: Bag::new(0, 0, 0) };

// ---- the live worlds

#[derive(Clone)]
pub struct WorldHandle {
    pub tx: mpsc::Sender<Cmd>,
    pub online: Arc<AtomicU32>,
}

/// The worlds loaded: started when someone first joins (from the db), kept while the server runs.
#[derive(Default)]
pub struct Hub {
    worlds: Mutex<HashMap<String, WorldHandle>>,
}

impl Hub {
    pub async fn get(&self, db: &Db, maps: &Arc<Maps>, id: &str) -> anyhow::Result<Option<WorldHandle>> {
        let mut worlds = self.worlds.lock().await;
        if let Some(h) = worlds.get(id).filter(|h| !h.tx.is_closed()) {
            return Ok(Some(h.clone()));
        }
        let Some(info) = db.world(id.to_string()).await? else { return Ok(None) };
        let rows = db.things(id).await?;
        let maps = maps.clone();
        let map = info.map.clone();
        let ground = tokio::task::spawn_blocking(move || maps.get(&map)).await?;
        let world = World::new(info, rows, db.clone(), ground);
        let (tx, rx) = mpsc::channel(1024);
        let h = WorldHandle { tx, online: world.online.clone() };
        tokio::spawn(world.run(rx));
        worlds.insert(id.to_string(), h.clone());
        Ok(Some(h))
    }

    /// Players in world `id` now (0 if it isn't loaded).
    pub async fn online(&self, id: &str) -> u32 {
        self.worlds.lock().await.get(id).map_or(0, |h| h.online.load(Ordering::Relaxed))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn world() -> World {
        let info = WorldInfo { id: "w".into(), code: "ABCDEF".into(), name: "t".into(), map: "flat".into(), owner: "a".into(), rules: Rules::default() };
        let dir = std::env::temp_dir().join(format!("overhill-unit-{}.db", rand_id(8)));
        World::new(info, vec![], Db::open(&dir).unwrap(), Arc::new(Ground::flat()))
    }

    fn join(w: &mut World, pid: &str) -> (u32, mpsc::Receiver<Out>) {
        let (tx, rx) = mpsc::channel(1024);
        let (rtx, mut rrx) = oneshot::channel();
        w.handle(Cmd::Join { pid: pid.into(), name: pid.to_uppercase(), tx, reply: rtx });
        (rrx.try_recv().unwrap().unwrap(), rx)
    }

    fn at(w: &mut World, sid: u32, x: f32, z: f32, trailer: bool) {
        let mut e = vec![Entity::new(0, 1, proto::FLAG_TELEPORT, [x, 0.0, z], [0.0, 0.0, 0.0, 1.0])];
        if trailer {
            e.push(Entity::new(2, proto::KIND_TRAILER, 0, [x, 0.0, z - 5.0], [0.0, 0.0, 0.0, 1.0]));
        }
        w.handle(Cmd::Pose { sid, ents: e });
    }

    fn act(w: &mut World, sid: u32, m: ClientMsg) -> R {
        w.on_msg(sid, m)
    }

    #[test]
    fn gather_build_guard_raid() {
        let mut w = world();
        let (a, _ra) = join(&mut w, "a");
        let (b, _rb) = join(&mut w, "b");
        at(&mut w, a, 100.0, 100.0, true);
        act(&mut w, a, ClientMsg::Claim { x: 100.0, z: 100.0, r: 20.0 }).unwrap();
        let cid = w.claims.keys().next().unwrap().clone();
        assert!(w.guards[&cid], "the owner is inside");
        // a second claim, an overlapping one
        assert!(act(&mut w, a, ClientMsg::Claim { x: 300.0, z: 100.0, r: 20.0 }).is_err());
        at(&mut w, b, 120.0, 120.0, false);
        assert!(act(&mut w, b, ClientMsg::Claim { x: 120.0, z: 120.0, r: 20.0 }).unwrap_err().contains("too close"));
        // fell a tree outside, load the logs into the trailer, stock the claim, build
        at(&mut w, a, 150.0, 100.0, true);
        act(&mut w, a, ClientMsg::CutTree { tree: 7, x: 152.0, z: 100.0, h: 20.0 }).unwrap();
        assert!(act(&mut w, a, ClientMsg::CutTree { tree: 7, x: 152.0, z: 100.0, h: 20.0 }).is_err());
        let did = w.drops.keys().next().unwrap().clone();
        assert_eq!(w.drops[&did].qty, 5);
        act(&mut w, a, ClientMsg::Pick { drop: did.clone(), to: Store::Trailer }).unwrap();
        assert_eq!(w.invs["a"].trailer.wood, 5);
        assert!(w.drops.is_empty());
        at(&mut w, a, 100.0, 100.0, true);
        act(&mut w, a, ClientMsg::Deposit { claim: cid.clone(), from: Store::Trailer, bag: Bag::new(5, 0, 0) }).unwrap();
        act(&mut w, a, ClientMsg::Place { kind: "wall_log".into(), x: 102.0, y: 0.0, z: 100.0, rot: 0.0, variant: 0 }).unwrap();
        assert_eq!(w.claims[&cid].stock.wood, 1);
        assert!(act(&mut w, a, ClientMsg::Place { kind: "wall_log".into(), x: 102.0, y: 0.0, z: 104.0, rot: 0.0, variant: 0 }).unwrap_err().contains("3 wood"));
        // b can't build on a's land, and can't take while a is home
        at(&mut w, b, 110.0, 100.0, false);
        assert!(act(&mut w, b, ClientMsg::Place { kind: "bench".into(), x: 102.0, y: 0.0, z: 100.0, rot: 0.0, variant: 0 }).is_err());
        assert!(act(&mut w, b, ClientMsg::Take { claim: cid.clone(), to: Store::Carry, bag: Bag::new(1, 0, 0) }).unwrap_err().contains("guarded"));
        // a drives off: the land is open
        at(&mut w, a, 600.0, 600.0, true);
        assert!(!w.guards[&cid]);
        act(&mut w, b, ClientMsg::Take { claim: cid.clone(), to: Store::Carry, bag: Bag::new(1, 0, 0) }).unwrap();
        assert_eq!(w.invs["b"].carry.wood, 1);
        assert_eq!(w.claims[&cid].stock.wood, 0);
        // a leaves the game: still open (offline_guard off) — with it on, guarded
        w.handle(Cmd::Leave { sid: a });
        assert!(!w.guards[&cid]);
        w.info.rules.offline_guard = true;
        w.refresh_guards(None);
        assert!(w.guards[&cid]);
    }

    #[test]
    fn ground_edits_stay_in_the_claim() {
        let mut w = world();
        let (a, _ra) = join(&mut w, "a");
        at(&mut w, a, 0.0, 0.0, false);
        act(&mut w, a, ClientMsg::Claim { x: 0.0, z: 0.0, r: 16.0 }).unwrap();
        let cid = w.claims.keys().next().unwrap().clone();
        act(&mut w, a, ClientMsg::Shape { op: ShapeOp::Raise, x: 14.0, z: 0.0, r: 6.0, strength: 1.0, y: None }).unwrap();
        let cells = &w.cells[&cid];
        assert!(!cells.is_empty());
        for &(i, j) in cells.keys() {
            let (x, z) = w.ground.cell_pos(i, j);
            assert!(x.hypot(z) <= 16.0, "cell outside the claim at {x},{z}");
        }
        assert!((w.edit_at(&cid, 14.0, 0.0) - 1.0).abs() < 0.01);
        act(&mut w, a, ClientMsg::Shape { op: ShapeOp::Flatten, x: 14.0, z: 0.0, r: 6.0, strength: 1.0, y: Some(0.0) }).unwrap();
        assert!(w.edit_at(&cid, 14.0, 0.0).abs() < 0.01);
        assert!(act(&mut w, a, ClientMsg::Shape { op: ShapeOp::Raise, x: 40.0, z: 0.0, r: 6.0, strength: 1.0, y: None }).is_err());
        act(&mut w, a, ClientMsg::Pond { x: 0.0, z: 0.0, r: 6.0, depth: 2.0 }).unwrap();
        let p = w.ponds.values().next().unwrap();
        // (flat ground: the water 25 cm under the rim, the bowl's bottom its depth under that)
        assert!((p.level + 0.25).abs() < 0.01, "the waterline");
        assert!((w.edit_at(&cid, 0.0, 0.0) - (p.level - 2.0)).abs() < 0.01, "the bowl's bottom");
    }

    #[test]
    fn pose_speed_check() {
        let mut w = world();
        let (a, _ra) = join(&mut w, "a");
        at(&mut w, a, 0.0, 0.0, false);
        let jump = vec![Entity::new(0, 1, 0, [900.0, 0.0, 0.0], [0.0, 0.0, 0.0, 1.0])];
        w.handle(Cmd::Pose { sid: a, ents: jump });
        assert_eq!(w.ent(a, 0).unwrap().p[0], 0.0, "a 900 m jump in a frame is ignored");
    }

    /// The poses frames `rx` got since last asked: [(sid, x of its player entity)] each.
    fn frames(rx: &mut mpsc::Receiver<Out>) -> Vec<Vec<(u16, f32)>> {
        let mut out = vec![];
        while let Ok(o) = rx.try_recv() {
            if let Out::Bin(b) = o
                && b[0] == proto::TAG_POSES
            {
                out.push(proto::parse_poses(&b).unwrap().1.into_iter().map(|(s, e)| (s, e[0].p[0])).collect());
            }
        }
        out
    }

    #[test]
    fn poses_near_far_no_echo() {
        let mut w = world();
        let (a, mut ra) = join(&mut w, "a");
        let (b, mut rb) = join(&mut w, "b");
        let (c, mut rc) = join(&mut w, "c");
        at(&mut w, a, 0.0, 0.0, false);
        at(&mut w, b, 50.0, 0.0, false); // near a
        at(&mut w, c, 1000.0, 0.0, false); // far from both
        w.send_poses();
        // the first frame: everyone else, never yourself
        let fa = frames(&mut ra);
        assert_eq!(fa.len(), 1);
        let mut s: Vec<u16> = fa[0].iter().map(|(s, _)| *s).collect();
        s.sort();
        assert_eq!(s, [b as u16, c as u16]);
        assert!(frames(&mut rb)[0].iter().all(|(s, _)| *s as u32 != b));
        assert!(frames(&mut rc)[0].iter().all(|(s, _)| *s as u32 != c));
        // nobody moves: no frames at all
        w.send_poses();
        assert!(frames(&mut ra).is_empty() && frames(&mut rb).is_empty() && frames(&mut rc).is_empty());
        // b and c drive on for 8 ticks: a hears b every tick, c every 4th — and c's last move, once it stops
        let mut got_c = vec![];
        for k in 1..=8 {
            at(&mut w, b, 50.0 + k as f32, 0.0, false);
            at(&mut w, c, 1000.0 + k as f32, 0.0, false);
            w.send_poses();
            let f = frames(&mut ra);
            assert!(f[0].iter().any(|(s, x)| *s as u32 == b && *x == 50.0 + k as f32), "b each tick");
            got_c.extend(f[0].iter().filter(|(s, _)| *s as u32 == c).map(|(_, x)| *x));
        }
        assert_eq!(got_c.len(), 2, "c at a quarter of the rate: {got_c:?}");
        at(&mut w, c, 1009.5, 0.0, false);
        for _ in 0..4 {
            w.send_poses();
            got_c.extend(frames(&mut ra).iter().flatten().filter(|(s, _)| *s as u32 == c).map(|(_, x)| *x));
        }
        assert_eq!(got_c.last(), Some(&1009.5), "where c stopped arrives");
        let _ = frames(&mut rc);
    }
}
