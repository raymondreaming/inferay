use std::{net::SocketAddr, path::PathBuf};

use inferay_server::{ServerConfig, ServerHandle};

#[tokio::main]
async fn main() {
    let listen_addr: SocketAddr = std::env::var("INFERAY_DEV_BACKEND_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:4317".to_owned())
        .parse()
        .expect("invalid Inferay development backend address");
    let app_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .expect("Inferay server must live under native/server")
        .to_path_buf();
    let mut config = ServerConfig::new(listen_addr, app_root);
    config.live_reload = true;

    let mut server = ServerHandle::start(config).expect("unable to start Inferay services");
    println!("[inferay-dev] backend: http://{}", server.local_addr());
    tokio::signal::ctrl_c()
        .await
        .expect("unable to listen for shutdown signal");
    server.shutdown();
}
