use std::path::PathBuf;

use tracing_subscriber::EnvFilter;

// (mimalloc: the many small allocations of a busy server — frames, events — faster than the system allocator)
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into())).init();
    let env = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.to_string());
    let cfg = overhill_server::Config {
        addr: env("OVERHILL_ADDR", "0.0.0.0:5280").parse()?,
        db: PathBuf::from(env("OVERHILL_DB", "overhill.db")),
        maps: PathBuf::from(env("OVERHILL_MAPS", "../frontend/public/oth")),
    };
    let server = overhill_server::start(cfg).await?;
    tracing::info!("overhill server on http://{}", server.addr);
    tokio::signal::ctrl_c().await?;
    tracing::info!("stopping: writing everything out");
    server.stop().await;
    Ok(())
}
