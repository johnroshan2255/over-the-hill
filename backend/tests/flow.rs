//! Two players over real HTTP and WebSockets: sign up, make and join a world, see each other drive, fell a tree,
//! haul the logs in the trailer, claim land, stock it, build, get raided while away, and find it all still there
//! after the server restarts.

use std::{path::PathBuf, time::Duration};

use futures_util::{SinkExt, StreamExt};
use overhill_server::{
    Config, Server,
    proto::{self, Entity},
    wire,
    start,
};
use serde_json::{Value, json};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async, tungstenite::Message};

type Ws = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

async fn server(db: &std::path::Path) -> Server {
    start(Config { addr: "127.0.0.1:0".parse().unwrap(), db: db.to_path_buf(), maps: PathBuf::from("no-maps-here") }).await.unwrap()
}

struct Http {
    base: String,
    c: reqwest::Client,
}

impl Http {
    async fn post(&self, path: &str, token: Option<&str>, body: Value) -> (u16, Value) {
        let mut r = self.c.post(format!("{}{path}", self.base)).json(&body);
        if let Some(t) = token {
            r = r.bearer_auth(t);
        }
        let res = r.send().await.unwrap();
        (res.status().as_u16(), res.json().await.unwrap_or(Value::Null))
    }
    async fn get(&self, path: &str, token: &str) -> (u16, Value) {
        let res = self.c.get(format!("{}{path}", self.base)).bearer_auth(token).send().await.unwrap();
        (res.status().as_u16(), res.json().await.unwrap_or(Value::Null))
    }
    async fn put(&self, path: &str, token: &str, body: Value) -> u16 {
        self.c.put(format!("{}{path}", self.base)).bearer_auth(token).json(&body).send().await.unwrap().status().as_u16()
    }
}

struct Client {
    ws: Ws,
    sid: u32,
    welcome: Value,
    req: u32,
    /// Events that came while waiting for an answer (`ask`), for `until`.
    backlog: std::collections::VecDeque<Value>,
}

impl Client {
    async fn connect(addr: &str, world: &str, token: &str) -> Client {
        let (ws, _) = connect_async(format!("ws://{addr}/v1/worlds/{world}/ws?token={token}")).await.unwrap();
        let mut c = Client { ws, sid: 0, welcome: Value::Null, req: 0, backlog: Default::default() };
        let w = c.until("welcome").await;
        c.sid = w["you"]["sid"].as_u64().unwrap() as u32;
        c.welcome = w;
        c
    }

    /// The next text event of type `t` (others skipped).
    async fn until(&mut self, t: &str) -> Value {
        while let Some(v) = self.backlog.pop_front() {
            if v["t"] == t {
                return v;
            }
        }
        let t = t.to_string();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Some(v) = self.next_event().await
                    && v["t"] == t
                {
                    return v;
                }
            }
        })
        .await
        .unwrap_or_else(|_| panic!("no {t} event"))
    }

    /// The next frame as an event (None: a poses frame, skipped).
    async fn next_event(&mut self) -> Option<Value> {
        match self.ws.next().await.expect("closed").expect("ws") {
            Message::Binary(b) if b.first() != Some(&proto::TAG_POSES) => Some(wire::decode_ev(&b).expect("an event the schema reads")),
            Message::Text(_) => panic!("the server sent text"),
            _ => None,
        }
    }

    /// The next poses frame.
    async fn poses(&mut self) -> Vec<(u16, Vec<Entity>)> {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Message::Binary(b) = self.ws.next().await.expect("closed").expect("ws")
                    && b.first() == Some(&proto::TAG_POSES)
                {
                    return proto::parse_poses(&b).expect("poses frame").1;
                }
            }
        })
        .await
        .expect("no poses")
    }

    /// Sends an intent and waits for its answer: Ok(()) or Err(message).
    async fn ask(&mut self, mut msg: Value) -> Result<(), String> {
        self.req += 1;
        let req = self.req;
        msg["req"] = json!(req);
        self.ws.send(Message::Binary(wire::encode_intent(&msg).unwrap().into())).await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Some(v) = self.next_event().await {
                    if v["req"] == json!(req) {
                        return if v["t"] == "ok" { Ok(()) } else { Err(v["msg"].as_str().unwrap_or("").to_string()) };
                    }
                    self.backlog.push_back(v);
                }
            }
        })
        .await
        .expect("no answer")
    }

    async fn at(&mut self, x: f32, z: f32, trailer: bool) {
        let mut e = vec![Entity::new(0, 1, proto::FLAG_TELEPORT, [x, 0.0, z], [0.0, 0.0, 0.0, 1.0])];
        if trailer {
            e.push(Entity::new(2, proto::KIND_TRAILER, 2, [x, 0.0, z - 5.0], [0.0, 0.0, 0.0, 1.0]));
        }
        self.ws.send(Message::Binary(proto::pose_frame(&e).into())).await.unwrap();
    }
}

#[tokio::test]
async fn two_players_build_and_raid() {
    let db = std::env::temp_dir().join(format!("overhill-flow-{}.db", overhill_server::util::rand_id(8)));
    let srv = server(&db).await;
    let addr = srv.addr.to_string();
    let http = Http { base: format!("http://{addr}"), c: reqwest::Client::new() };

    // ---- accounts, saves, worlds
    let (s, a) = http.post("/v1/players", None, json!({ "name": "Asha" })).await;
    assert_eq!(s, 200);
    let (_, b) = http.post("/v1/players", None, json!({ "name": "Ravi" })).await;
    let (at, bt) = (a["token"].as_str().unwrap().to_string(), b["token"].as_str().unwrap().to_string());
    let aid = a["id"].as_str().unwrap();
    assert_eq!(http.post("/v1/players", None, json!({ "name": "  " })).await.0, 400);
    assert_eq!(http.get("/v1/me", "nope").await.0, 401);

    let save = json!({ "v": 1, "map": "valley", "car": "gwagen", "x": 1.0, "z": 2.0, "heading": 0.0, "hour": 9.0 });
    assert_eq!(http.put(&format!("/v1/saves/{aid}"), &at, save.clone()).await, 204);
    assert_eq!(http.get(&format!("/v1/saves/{aid}"), &at).await, (200, save));
    assert_eq!(http.get(&format!("/v1/saves/{aid}"), &bt).await.0, 403);

    let (s, w) = http.post("/v1/worlds", Some(&at), json!({ "name": "Over the ridge", "map": "flat" })).await;
    assert_eq!(s, 200, "{w}");
    let (wid, code) = (w["id"].as_str().unwrap().to_string(), w["code"].as_str().unwrap().to_string());
    assert_eq!(http.post("/v1/worlds", Some(&at), json!({ "name": "x", "map": "moon" })).await.0, 400);
    // ravi isn't a member until he joins with the code
    assert!(connect_async(format!("ws://{addr}/v1/worlds/{wid}/ws?token={bt}")).await.is_err());
    let (s, _) = http.post("/v1/worlds/join", Some(&bt), json!({ "code": code.to_lowercase() })).await;
    assert_eq!(s, 200);
    let (_, list) = http.get("/v1/worlds", &bt).await;
    assert_eq!(list[0]["id"], json!(wid));
    let (_, cat) = http.get("/v1/catalog", &bt).await;
    assert!(cat["pieces"].as_array().unwrap().len() > 20);

    // ---- into the world: see each other
    let mut ca = Client::connect(&addr, &wid, &at).await;
    let mut cb = Client::connect(&addr, &wid, &bt).await;
    let j = ca.until("joined").await;
    assert_eq!(j["name"], "Ravi");
    ca.at(150.0, 100.0, true).await;
    cb.at(300.0, 300.0, false).await;
    let seen = loop {
        let p = cb.poses().await;
        if let Some(e) = p.iter().filter(|(s, _)| *s as u32 == ca.sid).flat_map(|(_, es)| es).find(|e| e.slot == 2) {
            break *e;
        }
    };
    assert_eq!(seen.kind, proto::KIND_TRAILER);
    assert_eq!(seen.p, [150.0, 0.0, 95.0]);

    // ---- gather: fell a tree, logs into the trailer
    ca.ask(json!({ "t": "cut_tree", "tree": 41, "x": 152.0, "z": 100.0, "h": 24.0 })).await.unwrap();
    let drop = cb.until("drop").await["drop"].clone();
    assert_eq!(drop["qty"], 6);
    ca.ask(json!({ "t": "pick", "drop": drop["id"], "to": "trailer" })).await.unwrap();
    assert_eq!(cb.ask(json!({ "t": "cut_tree", "tree": 41, "x": 152.0, "z": 100.0, "h": 16.0 })).await.unwrap_err(), "that tree is already down");

    // ---- claim, stock, build
    ca.at(100.0, 100.0, true).await;
    ca.ask(json!({ "t": "claim", "x": 100.0, "z": 100.0, "r": 20.0 })).await.unwrap();
    let claim = cb.until("claim").await["claim"].clone();
    let cid = claim["id"].as_str().unwrap().to_string();
    assert_eq!(claim["owner_name"], "Asha");
    ca.ask(json!({ "t": "deposit", "claim": cid, "from": "trailer", "bag": { "wood": 6, "stone": 0, "metal": 0 } })).await.unwrap();
    ca.ask(json!({ "t": "place", "kind": "wall_log", "x": 104.0, "y": 0.0, "z": 100.0, "rot": 1.57, "variant": 0 })).await.unwrap();
    let piece = cb.until("piece").await["piece"].clone();
    assert_eq!(piece["kind"], "wall_log");
    ca.ask(json!({ "t": "pave", "mat": "dirt", "x": 100.0, "z": 96.0, "r": 2.0 })).await.unwrap();
    ca.ask(json!({ "t": "shape", "op": "flatten", "x": 96.0, "z": 100.0, "r": 4.0, "strength": 1.0, "y": 0.5 })).await.unwrap();
    assert!(!cb.until("cells").await["cells"].as_array().unwrap().is_empty());

    // ---- the guard: ravi can't take while asha is home; she drives off; he raids
    cb.at(110.0, 110.0, false).await;
    let e = cb.ask(json!({ "t": "take", "claim": cid, "to": "carry", "bag": { "wood": 2, "stone": 0, "metal": 0 } })).await.unwrap_err();
    assert!(e.contains("guarded"), "{e}");
    ca.at(800.0, 800.0, true).await;
    // (the first guard event is the claim's own: on)
    while cb.until("guard").await["on"] != false {}
    cb.ask(json!({ "t": "take", "claim": cid, "to": "carry", "bag": { "wood": 2, "stone": 0, "metal": 0 } })).await.unwrap();
    let raid = ca.until("raid").await;
    assert_eq!(raid["by_name"], "Ravi");
    assert_eq!(raid["bag"]["wood"], 2);
    assert_eq!(cb.ask(json!({ "t": "take", "claim": cid, "to": "carry", "bag": { "wood": 1, "stone": 0, "metal": 0 } })).await.unwrap_err(), "the stockpile is empty");
    cb.ask(json!({ "t": "cut_tree", "tree": 42, "x": 112.0, "z": 110.0, "h": 8.0 })).await.unwrap();
    let logs = cb.until("drop").await["drop"]["id"].clone();
    cb.ask(json!({ "t": "pick", "drop": logs, "to": "carry" })).await.unwrap(); // (2 in hand + the tree's 2: full)
    assert_eq!(cb.ask(json!({ "t": "mine", "node": "rock:9", "x": 110.0, "z": 112.0, "size": 4 })).await.unwrap_err(), "your hands are full");

    // ---- restart: it's all still there
    drop_clients(ca, cb).await;
    srv.stop().await;
    let srv = server(&db).await;
    let addr = srv.addr.to_string();
    let ca = Client::connect(&addr, &wid, &at).await;
    let st = &ca.welcome["state"];
    assert_eq!(st["claims"][0]["id"], json!(cid));
    assert_eq!(st["claims"][0]["stock"]["wood"], 0, "6 in, 4 for the wall, 2 raided");
    assert_eq!(st["pieces"][0]["kind"], "wall_log");
    let mut stumps: Vec<u64> = st["stumps"].as_array().unwrap().iter().map(|s| s["tree"].as_u64().unwrap()).collect();
    stumps.sort();
    assert_eq!(stumps, [41, 42]);
    assert_eq!(st["paint"][0][1][0]["mat"], "dirt");
    assert!(!st["cells"][0][1].as_array().unwrap().is_empty());
    let cb = Client::connect(&addr, &wid, &bt).await;
    assert_eq!(cb.welcome["inv"]["carry"]["wood"], 4);
    drop_clients(ca, cb).await;
    srv.stop().await;
    let _ = std::fs::remove_file(&db);
}

async fn drop_clients(mut a: Client, mut b: Client) {
    let _ = a.ws.close(None).await;
    let _ = b.ws.close(None).await;
    tokio::time::sleep(Duration::from_millis(100)).await;
}
