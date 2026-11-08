//! overhill's server: accounts, saves, and the shared worlds (docs/MULTIPLAYER.md, backend/README.md).

pub mod catalog;
pub mod db;
pub mod http;
pub mod map;
pub mod proto;
pub mod util;
pub mod wire;
pub mod world;

use std::{net::SocketAddr, path::PathBuf, sync::Arc};

pub struct Config {
    pub addr: SocketAddr,
    pub db: PathBuf,
    /// Where the maps' ground is (`frontend/public/oth`).
    pub maps: PathBuf,
}

pub struct App {
    pub db: db::Db,
    pub maps: Arc<map::Maps>,
    pub hub: world::Hub,
}

pub struct Server {
    pub addr: SocketAddr,
    pub app: Arc<App>,
    task: tokio::task::JoinHandle<()>,
}

/// Opens the db, binds, and serves in the background.
pub async fn start(cfg: Config) -> anyhow::Result<Server> {
    let app = Arc::new(App { db: db::Db::open(&cfg.db)?, maps: Arc::new(map::Maps::new(cfg.maps)), hub: world::Hub::default() });
    let listener = tokio::net::TcpListener::bind(cfg.addr).await?;
    let addr = listener.local_addr()?;
    let router = http::router(app.clone());
    // (TCP_NODELAY: a 60-byte pose frame goes now, not held ~40 ms by Nagle waiting for more)
    let listener = axum::serve::ListenerExt::tap_io(listener, |tcp: &mut tokio::net::TcpStream| {
        let _ = tcp.set_nodelay(true);
    });
    let task = tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, router).await {
            tracing::error!("server: {e}");
        }
    });
    Ok(Server { addr, app, task })
}

impl Server {
    /// Stops taking connections and writes everything out.
    pub async fn stop(self) {
        self.task.abort();
        self.app.db.flush().await;
    }
}
