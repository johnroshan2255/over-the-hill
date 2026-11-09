//! THE WIRE, pinned: one of every event and intent, as bytes (hex) and as its JSON shape, in tests/golden.json. The
//! server must write each event's bytes exactly and read each intent's; the game's tests (frontend/tests/wire.test.ts)
//! check the same file the other way round: read the events, write the intents. A change to proto/wire.json that
//! breaks either side fails here or there. `GOLDEN=update cargo test --test golden` writes the file afresh.

use overhill_server::{
    catalog::{Bag, Mat},
    wire,
    world::{Claim, Ev, Inv, Loose, NodeView, Piece, PlayerView, Pond, Rules, StateView, Stroke, StumpView, WorldInfo},
};
use serde_json::{Value, json};

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

fn events() -> Vec<Value> {
    let claim = Claim { id: "c1".into(), owner: "p1".into(), owner_name: "Asha".into(), x: 100.5, z: -20.25, r: 20.0, y: 68.4375, stock: Bag::new(6, 2, 1), created: 1_762_590_000_123 };
    let piece = Piece { id: "pc".into(), kind: "wall_log".into(), owner: "p1".into(), claim: "c1".into(), x: 104.0, y: 68.5, z: -20.0, rot: 1.5, variant: 2 };
    let loose = Loose { id: "d1".into(), mat: Mat::Wood, qty: 5, x: 1.5, y: 2.0, z: -3.0, claim: None };
    let loose2 = Loose { claim: Some("c1".into()), mat: Mat::Metal, ..loose.clone() };
    let stroke = Stroke { mat: "gravel".into(), x: 1.0, z: 2.0, r: 1.5 };
    let pond = Pond { id: "po".into(), claim: "c1".into(), x: 1.0, z: 2.0, r: 6.0, level: 66.75 };
    let inv = Inv { carry: Bag::new(1, 2, 0), trailer: Bag::new(30, 0, 4) };
    let info = WorldInfo { id: "w1".into(), code: "ABC234".into(), name: "Over the ridge".into(), map: "valley".into(), owner: "p1".into(), rules: Rules::default() };
    let paint = vec![stroke.clone()];
    let state = StateView {
        players: vec![PlayerView { sid: 1, id: "p1", name: "Asha" }, PlayerView { sid: 300, id: "p2", name: "Ravi ✓" }],
        claims: vec![&claim],
        guards: vec![("c1", true)],
        cells: vec![("c1", vec![[1024, 980, -150], [1025, 980, 32767]])],
        paint: vec![("c1", &paint)],
        pieces: vec![&piece],
        drops: vec![&loose, &loose2],
        stumps: vec![StumpView { tree: 41, x: 152.0, z: 100.0 }],
        nodes: vec![NodeView { key: "rock:9", left: 3 }],
        ponds: vec![&pond],
    };
    let evs = vec![
        Ev::Welcome { you: PlayerView { sid: 1, id: "p1", name: "Asha" }, world: &info, state, inv: &inv },
        Ev::Joined { sid: 2, id: "p2", name: "Ravi" },
        Ev::Left { sid: 2 },
        Ev::Chat { sid: 2, name: "Ravi", text: "on my way — 5 min" },
        Ev::TreeCut { tree: 123_456, x: 1.5, z: -2.5, by: 2 },
        Ev::TreeBack { tree: 7 },
        Ev::Drop { drop: &loose2 },
        Ev::DropGone { id: "d1" },
        Ev::Node { key: "scrap:mine", left: 0 },
        Ev::NodeBack { key: "rock:9" },
        Ev::Inv { inv: &inv },
        Ev::Claim { claim: &claim },
        Ev::ClaimGone { id: "c1" },
        Ev::Stock { claim: "c1", stock: Bag::new(0, 0, 0) },
        Ev::Guard { claim: "c1", on: false },
        Ev::Raid { claim: "c1", owner: "p1", by: 2, by_name: "Ravi", bag: Bag::new(2, 0, 0) },
        Ev::Piece { piece: &piece },
        Ev::PieceGone { id: "pc" },
        Ev::Cells { claim: "c1", cells: vec![[-1, 0, 1], [2047, 2048, -800]] },
        Ev::Pave { claim: "c1", stroke: &stroke },
        Ev::Pond { pond: &pond },
        Ev::PondGone { id: "po" },
        Ev::Ok { req: 300 },
        Ev::Err { req: Some(4), msg: "too far away" },
        Ev::Err { req: None, msg: "slow down" },
        Ev::Pong { n: 123_456_789 },
    ];
    evs.iter().map(|e| json!({ "hex": hex(&wire::encode_ev(e)), "json": serde_json::to_value(e).unwrap() })).collect()
}

fn intents() -> Vec<Value> {
    let v = vec![
        json!({ "t": "chat", "req": null, "text": "hello ✓" }),
        json!({ "t": "cut_tree", "req": 1, "tree": 41, "x": 152.0, "z": 100.5, "h": 16.0 }),
        json!({ "t": "mine", "req": 2, "node": "rock:9", "x": 1.0, "z": 2.0, "size": 4 }),
        json!({ "t": "pick", "req": 3, "drop": "d1", "to": "trailer" }),
        json!({ "t": "drop", "req": 4, "mat": "stone", "qty": 2, "from": "carry", "x": 1.0, "y": 2.0, "z": 3.0 }),
        json!({ "t": "deposit", "req": 5, "claim": "c1", "from": "trailer", "bag": { "wood": 6, "stone": 0, "metal": 0 } }),
        json!({ "t": "take", "req": 6, "claim": "c1", "to": "carry", "bag": { "wood": 2, "stone": 0, "metal": 0 } }),
        json!({ "t": "claim", "req": 7, "x": 100.0, "z": -20.25, "r": 20.0 }),
        json!({ "t": "unclaim", "req": 8, "claim": "c1" }),
        json!({ "t": "place", "req": 9, "kind": "wall_log", "x": 104.0, "y": 68.5, "z": -20.0, "rot": 1.5, "variant": 0 }),
        json!({ "t": "remove", "req": 10, "piece": "pc" }),
        json!({ "t": "shape", "req": 11, "op": "flatten", "x": 1.0, "z": 2.0, "r": 4.0, "strength": 0.5, "y": 68.5 }),
        json!({ "t": "shape", "req": 12, "op": "raise", "x": 1.0, "z": 2.0, "r": 4.0, "strength": 1.0, "y": null }),
        json!({ "t": "pave", "req": 13, "mat": "planks", "x": 1.0, "z": 2.0, "r": 1.5 }),
        json!({ "t": "pond", "req": 14, "x": 1.0, "z": 2.0, "r": 6.0, "depth": 1.5 }),
        json!({ "t": "ping", "req": null, "n": 99 }),
        json!({ "t": "stow", "req": 15, "from": "carry", "to": "trailer", "bag": { "wood": 3, "stone": 1, "metal": 0 } }),
    ];
    v.into_iter().map(|j| json!({ "hex": hex(&wire::encode_intent(&j).unwrap_or_else(|e| panic!("{j}: {e}"))), "json": j })).collect()
}

#[test]
fn the_wire_matches_the_golden_file() {
    let now = json!({ "events": events(), "intents": intents(), "poses": poses() });
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden.json");
    if std::env::var("GOLDEN").as_deref() == Ok("update") || !path.exists() {
        std::fs::write(&path, serde_json::to_string_pretty(&now).unwrap() + "\n").unwrap();
    }
    let gold: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    // the server writes every event exactly so, and reads each back to its JSON shape
    for (g, n) in gold["events"].as_array().unwrap().iter().zip(now["events"].as_array().unwrap()) {
        assert_eq!(g["hex"], n["hex"], "event {} — the bytes changed (GOLDEN=update if meant; then the game's test)", g["json"]["t"]);
        assert_eq!(wire::decode_ev(&unhex(g["hex"].as_str().unwrap())).as_ref(), Some(&g["json"]), "event {} reads back", g["json"]["t"]);
    }
    assert_eq!(gold["events"].as_array().unwrap().len(), now["events"].as_array().unwrap().len());
    // every intent: the bytes read to the same JSON, and the server's own decoder takes them
    for g in gold["intents"].as_array().unwrap() {
        let b = unhex(g["hex"].as_str().unwrap());
        assert_eq!(wire::decode_intent_json(&b).as_ref(), Some(&g["json"]), "intent {}", g["json"]["t"]);
        assert!(wire::decode_intent(&b).is_some(), "intent {} isn't a ClientMsg", g["json"]["t"]);
    }
    assert_eq!(gold["poses"], now["poses"], "the poses frames changed (GOLDEN=update if meant)");
    // a frame cut short, or with a byte too many, is refused
    let b = unhex(gold["intents"][1]["hex"].as_str().unwrap());
    assert!(wire::decode_intent(&b[..b.len() - 1]).is_none());
    assert!(wire::decode_intent(&[b.as_slice(), &[0]].concat()).is_none());
}

fn ent_json(e: &overhill_server::proto::Entity) -> Value {
    json!({ "slot": e.slot, "kind": e.kind, "flags": e.flags, "p": e.p, "q": e.q })
}

/// A client's pose frame and a server's poses frame, each with what it holds.
fn poses() -> Value {
    use overhill_server::proto::{self, Entity};
    let car = Entity::new(0, 1, proto::FLAG_TELEPORT, [100.5, 68.25, -20.0], [0.0, 0.38268343, 0.0, 0.9238795]);
    let trailer = Entity::new(2, proto::KIND_TRAILER, proto::FLAG_HITCHED, [100.5, 68.0, -26.0], [0.05, -0.7, 0.1, 0.7]);
    let walker = Entity::new(0, proto::KIND_FOOT, 0, [-3.0, 70.5, 2048.0], [0.0, -1.0, 0.0, 0.0]);
    let client = proto::pose_frame(&[car, trailer]);
    let mut server = vec![proto::TAG_POSES];
    server.extend_from_slice(&123_456u32.to_le_bytes());
    server.push(2);
    for (sid, es) in [(7u16, vec![car, trailer]), (300u16, vec![walker])] {
        server.extend_from_slice(&sid.to_le_bytes());
        server.push(es.len() as u8);
        for e in &es {
            server.extend_from_slice(&e.raw);
        }
    }
    assert!(proto::parse_poses(&server).is_some());
    json!({
        "client": { "hex": hex(&client), "ents": [ent_json(&car), ent_json(&trailer)],
                    "q_in": [[0.0, 0.38268343, 0.0, 0.9238795], [0.05, -0.7, 0.1, 0.7]] },
        "server": { "hex": hex(&server), "tick": 123_456, "players": [
            { "sid": 7, "ents": [ent_json(&car), ent_json(&trailer)] },
            { "sid": 300, "ents": [ent_json(&walker)] } ] },
    })
}
