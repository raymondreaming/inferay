use super::{ApiResult, ServerState, api_error, query_value, resolve_serveable_local_path};
use axum::{
    body::Body,
    extract::Request,
    http::{HeaderValue, Method, StatusCode},
    response::Response,
};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

const MAX_VIDEO_BYTES: u64 = 50 * 1024 * 1024;

pub(super) async fn serve(state: &ServerState, request: Request) -> ApiResult<Response> {
    let path = query_value(&request, "path")
        .filter(|path| !path.is_empty())
        .ok_or_else(|| api_error(StatusCode::BAD_REQUEST, "No path provided"))?;
    let path = resolve_serveable_local_path(state, &path)
        .await
        .ok_or_else(|| api_error(StatusCode::FORBIDDEN, "Access denied"))?;
    let content_type = match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("mp4" | "m4v") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        Some("ogv") => "video/ogg",
        _ => return Err(api_error(StatusCode::BAD_REQUEST, "Unsupported video type")),
    };
    let mut options = tokio::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NONBLOCK);
    let mut file = options.open(path).await?;
    let metadata = file.metadata().await?;
    if !metadata.is_file() {
        return Err(api_error(StatusCode::BAD_REQUEST, "Not a file"));
    }
    let length = metadata.len();
    if length > MAX_VIDEO_BYTES {
        return Err(api_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Video exceeds the 50 MB preview limit",
        ));
    }
    let range = if request.method() != Method::GET || request.headers().contains_key("if-range") {
        None
    } else {
        request.headers().get("range")
    };
    let bounds = match range {
        Some(value) => value
            .to_str()
            .ok()
            .and_then(|value| byte_range(value, length)),
        None => Some((0, length)),
    };
    let Some((start, end)) = bounds else {
        let mut response = Response::new(Body::empty());
        *response.status_mut() = StatusCode::RANGE_NOT_SATISFIABLE;
        response.headers_mut().insert(
            "content-range",
            HeaderValue::from_str(&format!("bytes */{length}")).unwrap(),
        );
        return Ok(response);
    };
    let count = end - start;
    let body = if request.method() == Method::HEAD || count == 0 {
        Body::empty()
    } else {
        file.seek(std::io::SeekFrom::Start(start)).await?;
        let reader = file.take(count);
        Body::from_stream(futures_util::stream::try_unfold(
            reader,
            |mut reader| async move {
                let mut buffer = vec![0; 64 * 1024];
                let read = reader.read(&mut buffer).await?;
                if read == 0 {
                    return Ok::<_, std::io::Error>(None);
                }
                buffer.truncate(read);
                Ok(Some((buffer, reader)))
            },
        ))
    };
    let mut response = Response::new(body);
    if range.is_some() {
        *response.status_mut() = StatusCode::PARTIAL_CONTENT;
        response.headers_mut().insert(
            "content-range",
            HeaderValue::from_str(&format!("bytes {start}-{}/{length}", end - 1)).unwrap(),
        );
    }
    let headers = response.headers_mut();
    headers.insert("content-type", HeaderValue::from_static(content_type));
    headers.insert(
        "content-length",
        HeaderValue::from_str(&count.to_string()).unwrap(),
    );
    headers.insert("accept-ranges", HeaderValue::from_static("bytes"));
    headers.insert(
        "cache-control",
        HeaderValue::from_static("private, no-store"),
    );
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        "content-security-policy",
        HeaderValue::from_static("default-src 'none'; sandbox"),
    );
    Ok(response)
}

fn byte_range(value: &str, length: u64) -> Option<(u64, u64)> {
    let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
    let number = |value: &str| {
        if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        value.parse::<u64>().ok()
    };
    if length == 0 {
        return None;
    }
    if start.is_empty() {
        let count = number(end)?;
        return (count > 0).then_some((length.saturating_sub(count), length));
    }
    let start = number(start)?;
    let end = if end.is_empty() {
        length
    } else {
        number(end)?.saturating_add(1).min(length)
    };
    (start < end).then_some((start, end))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ServerConfig, ServerHandle};

    #[tokio::test]
    async fn video_http_supports_seeking_and_rejects_unsafe_or_oversized_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        for directory in ["app", "home", "state"] {
            std::fs::create_dir(root.join(directory)).unwrap();
        }
        let mut config = ServerConfig::new("127.0.0.1:0".parse().unwrap(), root.join("app"));
        config.user_data_dir = root.join("state");
        config.home_directory = root.join("home");
        let auth = config.auth_token.clone();
        let mut server = ServerHandle::start(config).unwrap();
        let client = reqwest::Client::new();
        let path = root.join("state/projects/studio/runs/render/output/clip.mp4");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let bytes: Vec<u8> = (0..200_000).map(|i| (i % 251) as u8).collect();
        std::fs::write(&path, &bytes).unwrap();
        let get = |path: &std::path::Path| {
            let mut url =
                url::Url::parse(&format!("http://{}/api/video", server.local_addr())).unwrap();
            url.query_pairs_mut()
                .append_pair("path", &path.to_string_lossy());
            client
                .get(url)
                .header("x-inferay-auth", &auth)
                .header("sec-fetch-site", "same-origin")
        };
        let full = get(&path).send().await.unwrap();
        assert_eq!(full.status(), StatusCode::OK);
        assert_eq!(full.headers()["content-type"], "video/mp4");
        assert_eq!(full.headers()["accept-ranges"], "bytes");
        assert_eq!(full.bytes().await.unwrap().as_ref(), bytes);
        for (range, start, end) in [
            ("bytes=0-1", 0, 2),
            ("bytes=65530-65550", 65530, 65551),
            ("bytes=199995-", 199995, 200000),
            ("bytes=-5", 199995, 200000),
            ("bytes=199995-999999", 199995, 200000),
        ] {
            let response = get(&path).header("range", range).send().await.unwrap();
            assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
            assert_eq!(
                response.headers()["content-range"],
                format!("bytes {start}-{}/200000", end - 1)
            );
            assert_eq!(response.bytes().await.unwrap().as_ref(), &bytes[start..end]);
        }
        for range in [
            "bytes=200000-",
            "bytes=5-2",
            "bytes=-0",
            "bytes=0-1,3-4",
            "bytes=+1-2",
            "bytes=bad",
            "items=0-1",
        ] {
            let response = get(&path).header("range", range).send().await.unwrap();
            assert_eq!(
                response.status(),
                StatusCode::RANGE_NOT_SATISFIABLE,
                "{range}"
            );
            assert_eq!(response.headers()["content-range"], "bytes */200000");
        }
        let response = get(&path)
            .header("range", "bytes=0-1")
            .header("if-range", "old-validator")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.bytes().await.unwrap().len(), bytes.len());
        let head = client
            .head(get(&path).build().unwrap().url().clone())
            .header("x-inferay-auth", &auth)
            .header("sec-fetch-site", "same-origin")
            .header("range", "bytes=0-1")
            .send()
            .await
            .unwrap();
        assert_eq!(head.status(), StatusCode::OK);
        assert_eq!(head.headers()["content-length"], "200000");
        assert!(head.bytes().await.unwrap().is_empty());
        let denied = root.join("outside.mp4");
        std::fs::write(&denied, &bytes).unwrap();
        assert_eq!(
            get(&denied).send().await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
        #[cfg(unix)]
        {
            let link = path.with_file_name("escape.mp4");
            std::os::unix::fs::symlink(&denied, &link).unwrap();
            assert_eq!(
                get(&link).send().await.unwrap().status(),
                StatusCode::FORBIDDEN
            );
        }
        let unsupported = path.with_extension("html");
        std::fs::write(&unsupported, "<script>bad()</script>").unwrap();
        assert_eq!(
            get(&unsupported).send().await.unwrap().status(),
            StatusCode::BAD_REQUEST
        );
        std::fs::File::create(&path)
            .unwrap()
            .set_len(MAX_VIDEO_BYTES + 1)
            .unwrap();
        assert_eq!(
            get(&path).send().await.unwrap().status(),
            StatusCode::PAYLOAD_TOO_LARGE
        );
        std::fs::write(&path, []).unwrap();
        assert_eq!(
            get(&path)
                .header("range", "bytes=0-")
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::RANGE_NOT_SATISFIABLE
        );
        server.shutdown();
    }
}
