//! THE HTTP API and the WebSocket upgrade (backend/README.md lists them).

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{
        FromRequestParts, Path, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::sync::{mpsc, oneshot};

use crate::{
    App, catalog,
    db::PlayerRow,
    map::MAPS,
    proto::{self, Envelope},
    util::{clean_name, hex, rand_code, rand_hex32, rand_id},
    world::{Cmd, Out, Rules, WorldHandle, WorldInfo},
};

type Shared = Arc<App>;

pub struct AppError(StatusCode, String);

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> AppError {
        tracing::error!("{e:#}");
        AppError(StatusCode::INTERNAL_SERVER_ERROR, "server error".into())
    }
}

fn bad(msg: &str) -> AppError {
    AppError(StatusCode::BAD_REQUEST, msg.into())
}

type Res<T> = Result<T, AppError>;

pub fn token_hash(token: &str) -> String {
    hex(&Sha256::digest(token.as_bytes()))
}

/// The player a request is from (`Authorization: Bearer <token>`).
pub struct Player(pub PlayerRow);

impl FromRequestParts<Shared> for Player {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, app: &Shared) -> Res<Player> {
        let token = parts
            .headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or(AppError(StatusCode::UNAUTHORIZED, "sign in first".into()))?;
        player_of(app, token).await
    }
}

async fn player_of(app: &Shared, token: &str) -> Res<Player> {
    app.db
        .player_by_token(token_hash(token.trim()))
        .await?
        .map(Player)
        .ok_or(AppError(StatusCode::UNAUTHORIZED, "unknown player".into()))
}

pub fn router(app: Shared) -> Router {
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/v1/catalog", get(|| async { Json(catalog::catalog_json()) }))
        .route("/v1/players", post(create_player))
        .route("/v1/me", get(me).patch(rename))
        .route("/v1/saves/{player}", get(get_save).put(put_save))
        .route("/v1/worlds", get(list_worlds).post(create_world))
        .route("/v1/worlds/join", post(join_world))
        .route("/v1/worlds/{id}/ws", get(ws))
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(app)
}

#[derive(Deserialize)]
struct NameBody {
    name: String,
}

async fn create_player(State(app): State<Shared>, Json(b): Json<NameBody>) -> Res<Json<Value>> {
    let name = clean_name(&b.name, 20).ok_or(bad("a name is 1–20 characters"))?;
    let (id, token) = (rand_id(12), rand_hex32());
    app.db.create_player(id.clone(), name.clone(), token_hash(&token)).await?;
    Ok(Json(json!({ "id": id, "name": name, "token": token })))
}

async fn me(Player(p): Player) -> Json<PlayerRow> {
    Json(p)
}

async fn rename(State(app): State<Shared>, Player(p): Player, Json(b): Json<NameBody>) -> Res<Json<PlayerRow>> {
    let name = clean_name(&b.name, 20).ok_or(bad("a name is 1–20 characters"))?;
    app.db.rename_player(p.id.clone(), name.clone()).await?;
    Ok(Json(PlayerRow { id: p.id, name }))
}

fn own(p: &PlayerRow, id: &str) -> Res<()> {
    if p.id == id { Ok(()) } else { Err(AppError(StatusCode::FORBIDDEN, "not your save".into())) }
}

async fn get_save(State(app): State<Shared>, Player(p): Player, Path(id): Path<String>) -> Res<Response> {
    own(&p, &id)?;
    match app.db.get_save(id).await? {
        Some(s) => Ok(([("content-type", "application/json")], s).into_response()),
        None => Ok(AppError(StatusCode::NOT_FOUND, "no save".into()).into_response()),
    }
}

/// `save.ts`' Progress, as it is (an object with `v`), ≤ 64 KB.
async fn put_save(State(app): State<Shared>, Player(p): Player, Path(id): Path<String>, Json(v): Json<Value>) -> Res<StatusCode> {
    own(&p, &id)?;
    if !v.is_object() || v.get("v").is_none() {
        return Err(bad("a save is an object with a version (v)"));
    }
    let s = v.to_string();
    if s.len() > 64 * 1024 {
        return Err(bad("that save is too big"));
    }
    app.db.put_save(id, s).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn world_json(app: &Shared, w: &WorldInfo) -> Value {
    json!({ "id": w.id, "code": w.code, "name": w.name, "map": w.map, "owner": w.owner, "rules": w.rules,
            "online": app.hub.online(&w.id).await })
}

async fn list_worlds(State(app): State<Shared>, Player(p): Player) -> Res<Json<Value>> {
    let mut out = vec![];
    for w in app.db.worlds_of(p.id).await? {
        out.push(world_json(&app, &w).await);
    }
    Ok(Json(Value::Array(out)))
}

#[derive(Deserialize)]
struct NewWorld {
    name: String,
    #[serde(default = "valley")]
    map: String,
    #[serde(default)]
    rules: Option<Rules>,
}

fn valley() -> String {
    "valley".into()
}

async fn create_world(State(app): State<Shared>, Player(p): Player, Json(b): Json<NewWorld>) -> Res<Json<Value>> {
    let name = clean_name(&b.name, 32).ok_or(bad("a world's name is 1–32 characters"))?;
    if !MAPS.contains(&b.map.as_str()) && !(cfg!(debug_assertions) && b.map == "flat") {
        return Err(bad("no such map"));
    }
    let mut rules = b.rules.unwrap_or_default();
    rules.max_players = rules.max_players.clamp(1, 16);
    rules.claim_min_r = rules.claim_min_r.clamp(4.0, 40.0);
    rules.claim_max_r = rules.claim_max_r.clamp(rules.claim_min_r, 120.0);
    rules.claims_per_player = rules.claims_per_player.clamp(1, 4);
    let info = WorldInfo { id: rand_id(10), code: rand_code(), name, map: b.map, owner: p.id, rules };
    let w = app.db.create_world(info).await?;
    Ok(Json(world_json(&app, &w).await))
}

#[derive(Deserialize)]
struct Code {
    code: String,
}

async fn join_world(State(app): State<Shared>, Player(p): Player, Json(b): Json<Code>) -> Res<Json<Value>> {
    let code = b.code.trim().to_uppercase();
    let w = app.db.world_by_code(code).await?.ok_or(AppError(StatusCode::NOT_FOUND, "no world with that code".into()))?;
    app.db.add_member(w.id.clone(), p.id).await?;
    Ok(Json(world_json(&app, &w).await))
}

#[derive(Deserialize)]
struct WsQuery {
    /// (browsers can't set headers on a WebSocket: the token comes in the query)
    token: String,
}

async fn ws(State(app): State<Shared>, Path(id): Path<String>, Query(q): Query<WsQuery>, up: WebSocketUpgrade) -> Res<Response> {
    let Player(p) = player_of(&app, &q.token).await?;
    if !app.db.is_member(id.clone(), p.id.clone()).await? {
        return Err(AppError(StatusCode::FORBIDDEN, "join the world with its code first".into()));
    }
    let world = app.hub.get(&app.db, &app.maps, &id).await?.ok_or(AppError(StatusCode::NOT_FOUND, "no such world".into()))?;
    Ok(up.max_message_size(256 * 1024).on_upgrade(move |s| conn(s, world, p)))
}

/// One player's connection: their messages in, the world's out.
async fn conn(socket: WebSocket, world: WorldHandle, p: PlayerRow) {
    let (out_tx, mut out_rx) = mpsc::channel::<Out>(512);
    let (reply, joined) = oneshot::channel();
    let (mut sink, mut stream) = socket.split();
    if world.tx.send(Cmd::Join { pid: p.id.clone(), name: p.name.clone(), tx: out_tx, reply }).await.is_err() {
        return;
    }
    let sid = match joined.await {
        Ok(Ok(sid)) => sid,
        Ok(Err(why)) => {
            let _ = sink.send(Message::Close(Some(axum::extract::ws::CloseFrame { code: 4000, reason: why.into() }))).await;
            return;
        }
        Err(_) => return,
    };
    loop {
        tokio::select! {
            out = out_rx.recv() => match out {
                Some(Out::Text(t)) => if sink.send(Message::Text(t)).await.is_err() { break },
                Some(Out::Bin(b)) => if sink.send(Message::Binary(b)).await.is_err() { break },
                Some(Out::Close(why)) => {
                    let _ = sink.send(Message::Close(Some(axum::extract::ws::CloseFrame { code: 4001, reason: why.into() }))).await;
                    break;
                }
                None => break,
            },
            msg = stream.next() => match msg {
                Some(Ok(Message::Text(t))) => match serde_json::from_str::<Envelope>(&t) {
                    Ok(env) => if world.tx.send(Cmd::Msg { sid, env }).await.is_err() { break },
                    Err(e) => {
                        let err = json!({ "t": "err", "req": null, "msg": format!("bad message: {e}") }).to_string();
                        if sink.send(Message::Text(err.into())).await.is_err() { break }
                    }
                },
                Some(Ok(Message::Binary(b))) => {
                    if let Some(ents) = proto::parse_pose(&b)
                        && world.tx.send(Cmd::Pose { sid, ents }).await.is_err() { break }
                }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                Some(Ok(_)) => {}
            },
        }
    }
    let _ = world.tx.send(Cmd::Leave { sid }).await;
}
