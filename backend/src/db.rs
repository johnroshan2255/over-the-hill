//! STORAGE — SQLite (`overhill.db`): players, saves, worlds, members, and every world's THINGS as rows
//! (world, kind, id → JSON). The live worlds write their things through a background thread that coalesces them
//! (the last write of a row in 250 ms wins) and commits in one transaction; `flush` waits for it.

use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex, mpsc},
    time::Duration,
};

use rusqlite::{Connection, OptionalExtension, params};

use crate::util::now_ms;
use crate::world::{Rules, WorldInfo};

enum Write {
    Put { world: String, kind: &'static str, id: String, data: String },
    Del { world: String, kind: &'static str, id: String },
    Flush(mpsc::Sender<()>),
}

#[derive(Clone)]
pub struct Db {
    conn: Arc<Mutex<Connection>>,
    tx: mpsc::Sender<Write>,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct PlayerRow {
    pub id: String,
    pub name: String,
}

const SCHEMA: &str = "
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS saves (player TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS worlds (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, map TEXT NOT NULL,
  owner TEXT NOT NULL, rules TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS members (world TEXT NOT NULL, player TEXT NOT NULL, joined INTEGER NOT NULL, PRIMARY KEY (world, player));
CREATE TABLE IF NOT EXISTS things (world TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY (world, kind, id));
";

type Key = (String, &'static str, String);

impl Db {
    pub fn open(path: &Path) -> anyhow::Result<Db> {
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        let conn = Arc::new(Mutex::new(conn));
        let (tx, rx) = mpsc::channel::<Write>();
        let c = conn.clone();
        std::thread::Builder::new().name("db-writer".into()).spawn(move || writer(c, rx))?;
        Ok(Db { conn, tx })
    }

    /// Runs `f` on the connection off the async threads.
    async fn call<T, F>(&self, f: F) -> anyhow::Result<T>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection) -> rusqlite::Result<T> + Send + 'static,
    {
        let c = self.conn.clone();
        Ok(tokio::task::spawn_blocking(move || f(&mut c.lock().unwrap())).await??)
    }

    // ---- the worlds' things (write-behind)

    pub fn put(&self, world: &str, kind: &'static str, id: &str, data: String) {
        let _ = self.tx.send(Write::Put { world: world.into(), kind, id: id.into(), data });
    }

    pub fn del(&self, world: &str, kind: &'static str, id: &str) {
        let _ = self.tx.send(Write::Del { world: world.into(), kind, id: id.into() });
    }

    /// Waits until everything written so far is on disk.
    pub async fn flush(&self) {
        let (tx, rx) = mpsc::channel();
        if self.tx.send(Write::Flush(tx)).is_ok() {
            let _ = tokio::task::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(10))).await;
        }
    }

    pub async fn things(&self, world: &str) -> anyhow::Result<Vec<(String, String, String)>> {
        let world = world.to_string();
        self.call(move |c| {
            let mut st = c.prepare("SELECT kind, id, data FROM things WHERE world = ?1")?;
            let rows = st.query_map([world], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
            rows.collect()
        })
        .await
    }

    // ---- players

    pub async fn create_player(&self, id: String, name: String, token_hash: String) -> anyhow::Result<()> {
        self.call(move |c| {
            c.execute("INSERT INTO players (id, name, token_hash, created) VALUES (?1, ?2, ?3, ?4)", params![id, name, token_hash, now_ms() as i64])
                .map(|_| ())
        })
        .await
    }

    pub async fn player_by_token(&self, token_hash: String) -> anyhow::Result<Option<PlayerRow>> {
        self.call(move |c| {
            c.query_row("SELECT id, name FROM players WHERE token_hash = ?1", [token_hash], |r| Ok(PlayerRow { id: r.get(0)?, name: r.get(1)? }))
                .optional()
        })
        .await
    }

    pub async fn rename_player(&self, id: String, name: String) -> anyhow::Result<()> {
        self.call(move |c| c.execute("UPDATE players SET name = ?2 WHERE id = ?1", params![id, name]).map(|_| ())).await
    }

    // ---- saves (save.ts' Progress, as JSON)

    pub async fn get_save(&self, player: String) -> anyhow::Result<Option<String>> {
        self.call(move |c| c.query_row("SELECT data FROM saves WHERE player = ?1", [player], |r| r.get(0)).optional()).await
    }

    pub async fn put_save(&self, player: String, data: String) -> anyhow::Result<()> {
        self.call(move |c| {
            c.execute(
                "INSERT INTO saves (player, data, updated) VALUES (?1, ?2, ?3)
                 ON CONFLICT(player) DO UPDATE SET data = excluded.data, updated = excluded.updated",
                params![player, data, now_ms() as i64],
            )
            .map(|_| ())
        })
        .await
    }

    // ---- worlds

    /// A new world (and its owner as a member); retries the join code if it's taken.
    pub async fn create_world(&self, info: WorldInfo) -> anyhow::Result<WorldInfo> {
        self.call(move |c| {
            let mut info = info;
            let rules = serde_json::to_string(&info.rules).expect("rules");
            for _ in 0..20 {
                let tx = c.transaction()?;
                let r = tx.execute(
                    "INSERT INTO worlds (id, code, name, map, owner, rules, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![info.id, info.code, info.name, info.map, info.owner, rules, now_ms() as i64],
                );
                match r {
                    Ok(_) => {
                        tx.execute("INSERT INTO members (world, player, joined) VALUES (?1, ?2, ?3)", params![info.id, info.owner, now_ms() as i64])?;
                        tx.commit()?;
                        return Ok(info);
                    }
                    Err(rusqlite::Error::SqliteFailure(e, _)) if e.code == rusqlite::ErrorCode::ConstraintViolation => {
                        info.code = crate::util::rand_code();
                    }
                    Err(e) => return Err(e),
                }
            }
            Err(rusqlite::Error::InvalidQuery)
        })
        .await
    }

    pub async fn world(&self, id: String) -> anyhow::Result<Option<WorldInfo>> {
        self.call(move |c| c.query_row("SELECT id, code, name, map, owner, rules FROM worlds WHERE id = ?1", [id], world_row).optional()).await
    }

    pub async fn world_by_code(&self, code: String) -> anyhow::Result<Option<WorldInfo>> {
        self.call(move |c| c.query_row("SELECT id, code, name, map, owner, rules FROM worlds WHERE code = ?1", [code], world_row).optional())
            .await
    }

    pub async fn add_member(&self, world: String, player: String) -> anyhow::Result<()> {
        self.call(move |c| {
            c.execute("INSERT OR IGNORE INTO members (world, player, joined) VALUES (?1, ?2, ?3)", params![world, player, now_ms() as i64]).map(|_| ())
        })
        .await
    }

    pub async fn is_member(&self, world: String, player: String) -> anyhow::Result<bool> {
        self.call(move |c| {
            c.query_row("SELECT 1 FROM members WHERE world = ?1 AND player = ?2", [world, player], |_| Ok(())).optional().map(|o| o.is_some())
        })
        .await
    }

    pub async fn worlds_of(&self, player: String) -> anyhow::Result<Vec<WorldInfo>> {
        self.call(move |c| {
            let mut st = c.prepare(
                "SELECT w.id, w.code, w.name, w.map, w.owner, w.rules FROM worlds w JOIN members m ON m.world = w.id
                 WHERE m.player = ?1 ORDER BY m.joined DESC",
            )?;
            let rows = st.query_map([player], world_row)?;
            rows.collect()
        })
        .await
    }
}

fn world_row(r: &rusqlite::Row) -> rusqlite::Result<WorldInfo> {
    let rules: String = r.get(5)?;
    Ok(WorldInfo {
        id: r.get(0)?,
        code: r.get(1)?,
        name: r.get(2)?,
        map: r.get(3)?,
        owner: r.get(4)?,
        rules: serde_json::from_str::<Rules>(&rules).unwrap_or_default(),
    })
}

fn writer(conn: Arc<Mutex<Connection>>, rx: mpsc::Receiver<Write>) {
    let mut pending: HashMap<Key, Option<String>> = HashMap::new();
    let commit = |pending: &mut HashMap<Key, Option<String>>| {
        if pending.is_empty() {
            return;
        }
        let mut c = conn.lock().unwrap();
        let r = (|| -> rusqlite::Result<()> {
            let tx = c.transaction()?;
            {
                let mut put = tx.prepare_cached(
                    "INSERT INTO things (world, kind, id, data) VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT(world, kind, id) DO UPDATE SET data = excluded.data",
                )?;
                let mut del = tx.prepare_cached("DELETE FROM things WHERE world = ?1 AND kind = ?2 AND id = ?3")?;
                for ((w, k, id), d) in pending.iter() {
                    match d {
                        Some(d) => put.execute(params![w, k, id, d])?,
                        None => del.execute(params![w, k, id])?,
                    };
                }
            }
            tx.commit()
        })();
        if let Err(e) = r {
            tracing::error!("db write of {} rows failed: {e}", pending.len());
        }
        pending.clear();
    };
    let mut last = std::time::Instant::now();
    loop {
        match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(Write::Put { world, kind, id, data }) => {
                pending.insert((world, kind, id), Some(data));
            }
            Ok(Write::Del { world, kind, id }) => {
                pending.insert((world, kind, id), None);
            }
            Ok(Write::Flush(done)) => {
                commit(&mut pending);
                let _ = done.send(());
            }
            Err(mpsc::RecvTimeoutError::Timeout) => commit(&mut pending),
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                commit(&mut pending);
                return;
            }
        }
        // (a steady stream of writes never times out: commit every 250 ms anyway, or at 1000 rows)
        if pending.len() >= 1000 || last.elapsed() >= Duration::from_millis(250) {
            commit(&mut pending);
        }
        if pending.is_empty() {
            last = std::time::Instant::now();
        }
    }
}
