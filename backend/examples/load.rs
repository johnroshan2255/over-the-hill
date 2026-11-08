//! LOAD TEST: W worlds × P players against a running server, each player driving a circle (poses 20 Hz) and pinging
//! once a second. Reports the round trip (p50 / p99 / max), the poses frames each player got a second, bytes in.
//!
//!   cargo run --release --example load -- [addr=127.0.0.1:5280] [worlds=16] [players=16] [seconds=20]

use std::{
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use futures_util::{SinkExt, StreamExt};
use overhill_server::{
    proto::{self, Entity},
    wire,
};
use serde_json::{Value, json};
use tokio::sync::Mutex;
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Default)]
struct Stats {
    rtts: Mutex<Vec<f64>>,
    frames: AtomicU64,
    bytes: AtomicU64,
    events: AtomicU64,
}

async fn post(c: &reqwest::Client, base: &str, path: &str, token: Option<&str>, body: Value) -> Value {
    let mut r = c.post(format!("{base}{path}")).json(&body);
    if let Some(t) = token {
        r = r.bearer_auth(t);
    }
    r.send().await.expect("http").json().await.expect("json")
}

#[tokio::main]
async fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let addr = a.first().cloned().unwrap_or_else(|| "127.0.0.1:5280".into());
    let worlds: usize = a.get(1).and_then(|s| s.parse().ok()).unwrap_or(16);
    let players: usize = a.get(2).and_then(|s| s.parse().ok()).unwrap_or(16);
    let secs: u64 = a.get(3).and_then(|s| s.parse().ok()).unwrap_or(20);
    let base = format!("http://{addr}");
    let c = reqwest::Client::new();
    let stats = Arc::new(Stats::default());
    let start = Instant::now() + Duration::from_secs(2);
    let end = start + Duration::from_secs(secs);
    let mut tasks = vec![];
    println!("{worlds} worlds × {players} players, {secs} s, against {addr}");
    for w in 0..worlds {
        let owner = post(&c, &base, "/v1/players", None, json!({ "name": format!("w{w}p0") })).await;
        let world = post(&c, &base, "/v1/worlds", owner["token"].as_str(), json!({ "name": format!("load {w}"), "map": "valley" })).await;
        let (wid, code) = (world["id"].as_str().expect("world").to_string(), world["code"].as_str().unwrap().to_string());
        for p in 0..players {
            let token = if p == 0 {
                owner["token"].as_str().unwrap().to_string()
            } else {
                let pl = post(&c, &base, "/v1/players", None, json!({ "name": format!("w{w}p{p}") })).await;
                let t = pl["token"].as_str().unwrap().to_string();
                post(&c, &base, "/v1/worlds/join", Some(&t), json!({ "code": code })).await;
                t
            };
            let (ws, _) = connect_async(format!("ws://{addr}/v1/worlds/{wid}/ws?token={token}")).await.expect("ws");
            let stats = stats.clone();
            tasks.push(tokio::spawn(async move {
                let (mut tx, mut rx) = ws.split();
                let st = stats.clone();
                let reader = tokio::spawn(async move {
                    let t0 = Instant::now();
                    while let Some(Ok(m)) = rx.next().await {
                        if let Message::Binary(b) = m {
                            let now = Instant::now();
                            if now >= start && now < end {
                                st.bytes.fetch_add(b.len() as u64, Ordering::Relaxed);
                                if b[0] == proto::TAG_POSES {
                                    st.frames.fetch_add(1, Ordering::Relaxed);
                                } else {
                                    st.events.fetch_add(1, Ordering::Relaxed);
                                }
                            }
                            if b[0] != proto::TAG_POSES
                                && let Some(v) = wire::decode_ev(&b)
                                && v["t"] == "pong"
                            {
                                let sent = v["n"].as_u64().unwrap() as f64 / 10.0;
                                st.rtts.lock().await.push(t0.elapsed().as_secs_f64() * 1000.0 - sent);
                            }
                        }
                    }
                });
                let t0 = Instant::now();
                let mut tick = tokio::time::interval(Duration::from_millis(50));
                let (cx, cz, r) = (-400.0 + (w * 37 % 800) as f32, -300.0 + (p * 53 % 600) as f32, 30.0 + p as f32);
                let mut k = 0u32;
                while Instant::now() < end {
                    tick.tick().await;
                    let a = t0.elapsed().as_secs_f32() * 0.4 + p as f32;
                    let q = [0.0, (a / 2.0).sin(), 0.0, (a / 2.0).cos()];
                    let e = Entity::new(0, 1, 0, [cx + a.cos() * r, 70.0, cz + a.sin() * r], q);
                    if tx.send(Message::Binary(proto::pose_frame(&[e]).into())).await.is_err() {
                        break;
                    }
                    k += 1;
                    if k.is_multiple_of(20) && Instant::now() >= start {
                        // (the send time in tenths of a ms since this client started)
                        let n = (t0.elapsed().as_secs_f64() * 10_000.0) as u64;
                        let ping = wire::encode_intent(&json!({ "t": "ping", "req": null, "n": n })).unwrap();
                        if tx.send(Message::Binary(ping.into())).await.is_err() {
                            break;
                        }
                    }
                }
                let _ = tx.close().await;
                reader.abort();
            }));
        }
    }
    for t in tasks {
        let _ = t.await;
    }
    let mut r = stats.rtts.lock().await.clone();
    r.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let pct = |p: f64| r.get(((r.len() as f64 - 1.0) * p) as usize).copied().unwrap_or(f64::NAN);
    let n = (worlds * players) as f64;
    println!(
        "round trip: p50 {:.2} ms · p99 {:.2} ms · max {:.2} ms ({} pings)",
        pct(0.5),
        pct(0.99),
        r.last().copied().unwrap_or(f64::NAN),
        r.len()
    );
    println!(
        "poses frames: {:.1} /s a player (20 sent) · in: {:.1} KB/s a player · events {}",
        stats.frames.load(Ordering::Relaxed) as f64 / n / secs as f64,
        stats.bytes.load(Ordering::Relaxed) as f64 / n / secs as f64 / 1024.0,
        stats.events.load(Ordering::Relaxed)
    );
}
