//! Provider-advertised icons, shared by chat views. No guessed favicon URLs.
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    net::IpAddr,
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};
use tokio::sync::OnceCell;

const MAX_BYTES: usize = 256 * 1024;
type IconBytes = Option<(String, Vec<u8>)>;
#[derive(Default)]
struct Registry {
    servers: HashMap<String, String>,
    images: HashMap<String, Arc<OnceCell<IconBytes>>>,
}
static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
fn registry() -> &'static Mutex<Registry> {
    REGISTRY.get_or_init(Default::default)
}

pub fn register(page: &Value) {
    let Some(servers) = page["data"].as_array() else {
        return;
    };
    let mut registry = registry().lock().unwrap();
    for server in servers {
        let Some(name) = server["name"].as_str() else {
            continue;
        };
        let Some((source, _)) =
            inferay_core::mcp_presentation::resolve(&format!("mcp__{name}__icon"))
        else {
            continue;
        };
        let icon = server
            .pointer("/serverInfo/icons")
            .and_then(Value::as_array)
            .and_then(|icons| {
                icons
                    .iter()
                    .filter_map(|icon| icon["src"].as_str())
                    .find(|src| supported_source(src))
            });
        if let Some(icon) = icon {
            registry.servers.insert(source.server_id, icon.to_owned());
        } else if server.get("serverInfo").is_some_and(Value::is_object) {
            registry.servers.remove(&source.server_id);
        }
    }
}
fn supported_source(src: &str) -> bool {
    src.len() <= MAX_BYTES * 2 && (src.starts_with("https://") || src.starts_with("data:image/"))
}
pub fn manifest() -> Value {
    let registry = registry().lock().unwrap();
    let icons: serde_json::Map<String, Value> = registry
        .servers
        .iter()
        .map(|(server, src)| {
            // A changed source gets a new browser cache key.
            use std::hash::{Hash, Hasher};
            let mut hash = std::collections::hash_map::DefaultHasher::new();
            src.hash(&mut hash);
            (
                server.clone(),
                json!(format!(
                    "/api/mcp-icon?server={server}&v={:x}",
                    hash.finish()
                )),
            )
        })
        .collect();
    Value::Object(icons)
}
pub async fn get(server: &str) -> IconBytes {
    let (src, cell) = {
        let mut registry = registry().lock().unwrap();
        let src = registry.servers.get(server)?.clone();
        // Bound session cache memory; do not evict an in-flight download.
        if registry.images.len() >= 128 && !registry.images.contains_key(&src) {
            let completed = registry
                .images
                .iter()
                .find(|(_, cell)| cell.get().is_some())
                .map(|(key, _)| key.clone());
            if let Some(key) = completed {
                registry.images.remove(&key);
            } else {
                return None;
            }
        }
        let cell = registry.images.entry(src.clone()).or_default().clone();
        (src, cell)
    };
    cell.get_or_init(|| async {
        tokio::time::timeout(Duration::from_secs(5), load(&src))
            .await
            .ok()
            .flatten()
    })
    .await
    .clone()
}
fn content_type(value: &str) -> Option<&str> {
    match value.split(';').next()?.trim() {
        value @ ("image/png"
        | "image/jpeg"
        | "image/gif"
        | "image/webp"
        | "image/svg+xml"
        | "image/x-icon"
        | "image/vnd.microsoft.icon") => Some(value),
        _ => None,
    }
}
fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            !(ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_unspecified()
                || ip.is_multicast()
                || ip.is_broadcast()
                || ip.is_documentation()
                || ip.octets()[0] == 0
                || ip.octets()[0] >= 240
                || (ip.octets()[0] == 100 && (64..=127).contains(&ip.octets()[1])))
        }
        IpAddr::V6(ip) => ip
            .to_ipv4_mapped()
            .map(|ip| public_ip(IpAddr::V4(ip)))
            .unwrap_or_else(|| {
                let first = ip.segments()[0];
                first & 0xe000 == 0x2000 && !(first == 0x2001 && ip.segments()[1] == 0xdb8)
            }),
    }
}
async fn load(src: &str) -> IconBytes {
    if let Some(data) = src.strip_prefix("data:") {
        use base64::Engine;
        let (header, bytes) = data.split_once(',')?;
        let mime = content_type(header)?.to_owned();
        let bytes = if header.ends_with(";base64") {
            base64::engine::general_purpose::STANDARD
                .decode(bytes)
                .ok()?
        } else {
            percent_encoding::percent_decode_str(bytes).collect()
        };
        return (bytes.len() <= MAX_BYTES).then_some((mime, bytes));
    }
    let url = url::Url::parse(src).ok()?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    let host = url.host_str()?;
    let addresses: Vec<_> = tokio::net::lookup_host((host, url.port_or_known_default()?))
        .await
        .ok()?
        .collect();
    if addresses.is_empty() || addresses.iter().any(|address| !public_ip(address.ip())) {
        return None;
    }
    // Pin checked DNS results and disallow redirects to private destinations.
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(4))
        .resolve_to_addrs(host, &addresses)
        .build()
        .ok()?;
    let mut response = client.get(url).send().await.ok()?.error_for_status().ok()?;
    let mime = content_type(response.headers().get("content-type")?.to_str().ok()?)?.to_owned();
    if response
        .content_length()
        .is_some_and(|size| size > MAX_BYTES as u64)
    {
        return None;
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return None;
        }
        bytes.extend_from_slice(&chunk);
    }
    Some((mime, bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn discovers_server_metadata_and_decodes_local_icons() {
        register(
            &json!({"data":[{"name":"test_icon_server","serverInfo":{"icons":[{"src":"file:///private/icon"},{"src":"data:image/png;base64,aGVsbG8="}]}}]}),
        );
        assert!(
            manifest()["testiconserver"]
                .as_str()
                .unwrap()
                .starts_with("/api/mcp-icon?")
        );
        assert_eq!(
            get("testiconserver").await,
            Some(("image/png".into(), b"hello".to_vec()))
        );
        assert_eq!(get("missing").await, None);
        register(&json!({"data":[{"name":"test_icon_server","serverInfo":null}]}));
        assert!(manifest().get("testiconserver").is_some());
        register(&json!({"data":[{"name":"test_icon_server","serverInfo":{}}]}));
        assert!(manifest().get("testiconserver").is_none());
    }
    #[test]
    fn rejects_private_networks_and_non_image_types() {
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "169.254.169.254",
            "::1",
            "::ffff:127.0.0.1",
            "fc00::1",
        ] {
            assert!(!public_ip(ip.parse().unwrap()));
        }
        assert!(public_ip("8.8.8.8".parse().unwrap()));
        assert_eq!(content_type("text/html"), None);
        assert!(!supported_source("http://example.com/icon.png"));
    }
}
