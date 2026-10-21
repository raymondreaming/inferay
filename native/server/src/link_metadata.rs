//! Optional, bounded previews of public web pages. Never forward browser credentials.
use base64::Engine;
use dom_query::Document;
use inferay_presentation::composer::LinkMetadata;
use std::{net::IpAddr, time::Duration};
use url::Url;

fn public_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && !ip.is_unspecified()
                && !ip.is_broadcast()
                && !ip.is_documentation()
                && !ip.is_multicast()
                && ip.octets()[0] != 0
                && ip.octets()[0] < 240
                && !(ip.octets()[0] == 100 && (64..128).contains(&ip.octets()[1]))
                && !(ip.octets()[0] == 198 && [18, 19].contains(&ip.octets()[1]))
                && !(ip.octets()[0] == 192 && ip.octets()[1] == 0 && ip.octets()[2] == 0)
        }
        IpAddr::V6(ip) => ip.to_ipv4_mapped().map_or_else(
            || {
                (ip.segments()[0] & 0xe000) == 0x2000
                    && !(ip.segments()[0] == 0x2001
                        && (ip.segments()[1] < 0x200 || ip.segments()[1] == 0xdb8))
                    && ip.segments()[0] != 0x3fff
                    && ip.segments()[0] != 0x2002
            },
            |ip| public_address(IpAddr::V4(ip)),
        ),
    }
}

async fn fetch(mut url: Url, limit: usize) -> Option<(Url, String, Vec<u8>)> {
    for _ in 0..4 {
        if !matches!(url.scheme(), "http" | "https")
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return None;
        }
        let host = url.host_str()?.trim_matches(['[', ']']);
        let port = url.port_or_known_default()?;
        if ![80, 443].contains(&port) {
            return None;
        }
        let addresses: Vec<_> = tokio::net::lookup_host((host, port)).await.ok()?.collect();
        if addresses.is_empty() || addresses.iter().any(|addr| !public_address(addr.ip())) {
            return None;
        }
        // Pin the validated DNS answer, including on each redirect, to avoid rebinding.
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(3))
            .resolve_to_addrs(host, &addresses)
            .build()
            .ok()?;
        let mut response = client
            .get(url.clone())
            .header("User-Agent", "Inferay-LinkPreview/1.0")
            .send()
            .await
            .ok()?;
        if response.status().is_redirection() {
            url = url
                .join(response.headers().get("location")?.to_str().ok()?)
                .ok()?;
            continue;
        }
        if !response.status().is_success() {
            return None;
        }
        let mime = response
            .headers()
            .get("content-type")?
            .to_str()
            .ok()?
            .to_owned();
        let html = mime.starts_with("text/html") || mime.starts_with("application/xhtml+xml");
        if !html && response.content_length().is_some_and(|n| n > limit as u64) {
            return None;
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.ok()? {
            if bytes.len() + chunk.len() > limit {
                if !html {
                    return None;
                }
                // Metadata lives near the start; large pages need not be downloaded in full.
                bytes.extend_from_slice(&chunk[..limit - bytes.len()]);
                break;
            }
            bytes.extend_from_slice(&chunk);
        }
        return Some((url, mime, bytes));
    }
    None
}

fn parse(html: &str, base: &Url) -> (Option<String>, Url) {
    let document = Document::from(html);
    let title = document
        .select("meta[property='og:title']")
        .iter()
        .find_map(|el| {
            el.attr("content")
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.to_string())
        })
        .or_else(|| Some(document.select_single("title").text().to_string()))
        .map(|s| {
            s.split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(200)
                .collect::<String>()
        })
        .filter(|s| !s.is_empty());
    let icon = document
        .select("link[href][rel]")
        .iter()
        .filter(|el| {
            el.attr_or("rel", "")
                .split_whitespace()
                .any(|rel| rel.eq_ignore_ascii_case("icon"))
        })
        .find_map(|el| base.join(&el.attr("href")?).ok())
        .unwrap_or_else(|| base.join("/favicon.ico").unwrap());
    (title, icon)
}

pub async fn load(raw: &str) -> LinkMetadata {
    tokio::time::timeout(Duration::from_secs(7), async {
        let mut metadata = LinkMetadata::default();
        let Ok(url) = Url::parse(raw) else {
            return metadata;
        };
        let Some((base, mime, bytes)) = fetch(url, 512 * 1024).await else {
            return metadata;
        };
        if !mime.starts_with("text/html") && !mime.starts_with("application/xhtml+xml") {
            return metadata;
        }
        let (title, icon) = parse(&String::from_utf8_lossy(&bytes), &base);
        metadata.title = title;
        if let Some((_, mime, bytes)) = fetch(icon, 128 * 1024).await {
            // Raster formats only: remote SVG never enters the app's origin.
            if matches!(
                mime.split(';').next().unwrap_or_default(),
                "image/png"
                    | "image/jpeg"
                    | "image/gif"
                    | "image/webp"
                    | "image/x-icon"
                    | "image/vnd.microsoft.icon"
            ) {
                metadata.icon = Some(format!(
                    "data:{};base64,{}",
                    mime.split(';').next().unwrap(),
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                ));
            }
        }
        metadata
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extracts_title_entities_and_relative_icon() {
        let (title, icon) = parse(
            r#"<title>Fallback</title><meta property="og:title" content="A &amp; B"><link rel="shortcut icon" href="/mark.png">"#,
            &Url::parse("https://example.com/page").unwrap(),
        );
        assert_eq!(title.as_deref(), Some("A & B"));
        assert_eq!(icon.as_str(), "https://example.com/mark.png");
        let (title, icon) = parse(
            "<title>  Plain\n title </title>",
            &Url::parse("https://example.com/page").unwrap(),
        );
        assert_eq!(title.as_deref(), Some("Plain title"));
        assert_eq!(icon.path(), "/favicon.ico");
    }
    #[test]
    fn blocks_local_and_special_networks() {
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "169.254.169.254",
            "192.168.1.1",
            "100.64.0.1",
            "::1",
            "::ffff:127.0.0.1",
            "fc00::1",
            "2002:7f00:1::",
        ] {
            assert!(!public_address(ip.parse().unwrap()), "{ip}");
        }
        assert!(public_address("1.1.1.1".parse().unwrap()));
        assert!(public_address("2001:4860:4860::8888".parse().unwrap()));
    }
    #[tokio::test]
    async fn unavailable_or_local_links_have_no_metadata() {
        for url in [
            "file:///etc/passwd",
            "http://127.0.0.1/",
            "https://user:pass@example.com/",
            "not a url",
        ] {
            let result = load(url).await;
            assert!(result.title.is_none() && result.icon.is_none());
        }
    }
}
