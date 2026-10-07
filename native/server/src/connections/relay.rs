//! Invocation-scoped, read-only HTTP access. Credentials never enter the tool process.
use super::*;
use axum::{
    Router,
    extract::{Path as RoutePath, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
};
use inferay_core::connections::ToolConnection;
use std::{
    collections::BTreeMap,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};
use tokio::sync::watch;

pub(crate) struct Relay {
    pub url: String,
    stop: watch::Sender<bool>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Relay {
    fn drop(&mut self) {
        let _ = self.stop.send(true);
        self.task.abort();
    }
}
#[derive(Clone)]
struct Access {
    store: Arc<Store>,
    project: String,
    token: String,
    requests: BTreeMap<String, ToolConnection>,
    approved: BTreeMap<String, ConnectionInfo>,
    stop: watch::Receiver<bool>,
    calls: Arc<AtomicUsize>,
    client: reqwest::Client,
}
impl Relay {
    pub async fn start(
        store: Arc<Store>,
        project: &str,
        requests: BTreeMap<String, ToolConnection>,
        approved: BTreeMap<String, ConnectionInfo>,
    ) -> Result<Self> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .timeout(std::time::Duration::from_secs(25))
            .build()
            .map_err(|_| "Connection client unavailable")?;
        Self::with_client(store, project, requests, approved, client).await
    }
    async fn with_client(
        store: Arc<Store>,
        project: &str,
        requests: BTreeMap<String, ToolConnection>,
        approved: BTreeMap<String, ConnectionInfo>,
        client: reqwest::Client,
    ) -> Result<Self> {
        for (alias, request) in &requests {
            request.validate()?;
            let info = approved
                .get(alias)
                .ok_or("Connection approval is missing")?;
            let store = store.clone();
            let project = project.to_owned();
            let info = info.clone();
            let request = request.clone();
            tokio::task::spawn_blocking(move || store.check_selected(&project, &request, &info))
                .await??;
        }
        if requests.len() != approved.len() {
            return Err("Connection approval does not match requested access".into());
        }
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let token = format!("{}{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4());
        let url = format!("http://{}/{token}", listener.local_addr()?);
        let (stop, receiver) = watch::channel(false);
        let app = Router::new()
            .route("/{token}/{alias}", get(request))
            .with_state(Access {
                store,
                project: project.into(),
                token,
                requests,
                approved,
                stop: receiver,
                calls: Arc::new(AtomicUsize::new(0)),
                client,
            });
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        Ok(Self { url, stop, task })
    }
}
impl Store {
    fn check_selected(
        &self,
        project: &str,
        request: &ToolConnection,
        approved: &ConnectionInfo,
    ) -> Result<()> {
        self.edit(|entries| {
            selected(entries, project, request, approved)?;
            Ok(((), false))
        })
    }
}
fn selected<'a>(
    entries: &'a [Credential],
    project: &str,
    request: &ToolConnection,
    approved: &ConnectionInfo,
) -> Result<&'a Credential> {
    if approved.project_id != project || approved.id != request.id {
        return Err("Connection approval has a different scope".into());
    }
    entries
        .iter()
        .find(|entry| {
            entry.info.project_id == project
                && entry.info.id == request.id
                && entry.info.revision == approved.revision
        })
        .ok_or_else(|| "Connection changed; review before requesting access".into())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RequestPath {
    path: String,
}
async fn request(
    State(mut access): State<Access>,
    RoutePath((token, alias)): RoutePath<(String, String)>,
    headers: HeaderMap,
    Query(query): Query<RequestPath>,
) -> Response {
    if token != access.token || headers.contains_key("origin") || *access.stop.borrow() {
        return (StatusCode::FORBIDDEN, "Connection access unavailable").into_response();
    }
    let Some(binding) = access.requests.get(&alias).cloned() else {
        return (StatusCode::NOT_FOUND, "Connection not granted").into_response();
    };
    let Some(approved) = access.approved.get(&alias).cloned() else {
        return (StatusCode::FORBIDDEN, "Connection not approved").into_response();
    };
    if access.calls.fetch_add(1, Ordering::AcqRel) >= 64 {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            "Connection request limit reached",
        )
            .into_response();
    }
    let pending = fetch(
        access.store.clone(),
        access.project.clone(),
        binding,
        approved,
        query.path,
        access.client.clone(),
    );
    let result = tokio::select! {
        _ = access.stop.changed() => return (StatusCode::FORBIDDEN, "Connection invocation ended").into_response(),
        result = tokio::time::timeout(std::time::Duration::from_secs(30), pending) => result,
    };
    match result {
        Ok(Ok((status, bytes))) => (
            status,
            [("content-type", "application/octet-stream")],
            bytes,
        )
            .into_response(),
        _ => (
            StatusCode::BAD_GATEWAY,
            "Connection request failed or exceeded its approved scope",
        )
            .into_response(),
    }
}
fn target(binding: &ToolConnection, path: &str) -> Result<url::Url> {
    binding.validate()?;
    if path.len() > 4096
        || path.starts_with('/')
        || path.contains('\\')
        || path.contains('#')
        || path.chars().any(char::is_control)
        || url::Url::parse(path).is_ok()
    {
        return Err("Connection path must be relative".into());
    }
    let base = url::Url::parse(&binding.base_url)?;
    let url = base.join(path)?;
    if url.origin() != base.origin()
        || !url.path().starts_with(base.path())
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Connection request leaves its approved base URL".into());
    }
    Ok(url)
}
async fn fetch(
    store: Arc<Store>,
    project: String,
    binding: ToolConnection,
    approved: ConnectionInfo,
    path: String,
    client: reqwest::Client,
) -> Result<(StatusCode, Vec<u8>)> {
    let url = target(&binding, &path)?;
    let header_name = reqwest::header::HeaderName::from_bytes(binding.header.as_bytes())
        .map_err(|_| "Invalid credential header")?;
    let (header, secret) = tokio::task::spawn_blocking(move || {
        store.edit(|entries| {
            let entry = selected(entries, &project, &binding, &approved)?;
            if entry.secret.is_empty() {
                return Err("Credential is empty".into());
            }
            let mut header = reqwest::header::HeaderValue::from_str(&format!(
                "{}{}",
                binding.prefix, entry.secret
            ))
            .map_err(|_| "Credential cannot be used as an HTTP header")?;
            header.set_sensitive(true);
            Ok(((header, entry.secret.clone()), false))
        })
    })
    .await??;
    let mut response = client
        .get(url)
        .header(header_name, header)
        .header("accept-encoding", "identity")
        .send()
        .await
        .map_err(|_| "Connection request failed")?;
    if response.status().is_redirection()
        || response
            .headers()
            .get("content-encoding")
            .is_some_and(|value| value != "identity")
    {
        return Err("Connection response is not supported".into());
    }
    if response
        .content_length()
        .is_some_and(|size| size > 1_048_576)
    {
        return Err("Connection response exceeds 1 MiB".into());
    }
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Connection response failed")?
    {
        if bytes.len() + chunk.len() > 1_048_576 {
            return Err("Connection response exceeds 1 MiB".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    use base64::Engine;
    const URI_COMPONENT: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
        .remove(b'-')
        .remove(b'.')
        .remove(b'_')
        .remove(b'~');
    let variants = [
        secret.clone(),
        base64::engine::general_purpose::STANDARD.encode(secret.as_bytes()),
        percent_encoding::utf8_percent_encode(&secret, percent_encoding::NON_ALPHANUMERIC)
            .to_string(),
        percent_encoding::utf8_percent_encode(&secret, URI_COMPONENT).to_string(),
        serde_json::to_string(&secret)?.trim_matches('"').to_owned(),
    ];
    if variants.iter().any(|value| {
        bytes
            .windows(value.len())
            .any(|window| window == value.as_bytes())
    }) {
        return Err("Connection response contains credential material".into());
    }
    Ok((status, bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn request_targets_cannot_escape_the_reviewed_base() {
        let binding = ToolConnection {
            id: uuid::Uuid::new_v4().to_string(),
            base_url: "https://api.example.test/v1/".into(),
            header: "Authorization".into(),
            prefix: "Bearer ".into(),
        };
        assert_eq!(
            target(&binding, "items?limit=2").unwrap().as_str(),
            "https://api.example.test/v1/items?limit=2"
        );
        for path in [
            "../private",
            "%2e%2e/private",
            "/outside",
            "//other.test/",
            "https://other.test/v1/",
            "https://api.example.test/v1/items",
            "https://user@api.example.test/v1/",
            "item#fragment",
            "..\\private",
            "item\nname",
        ] {
            assert!(target(&binding, path).is_err(), "{path}");
        }
    }
    #[cfg(target_os = "macos")]
    #[tokio::test]
    #[ignore = "uses a temporary Keychain item and local HTTPS fixture; requires openssl and python3"]
    async fn credential_relay_https_scope_rotation_and_shutdown() {
        use tokio::io::AsyncBufReadExt;
        let temp = tempfile::tempdir().unwrap();
        let cert = temp.path().join("cert.pem");
        let key = temp.path().join("key.pem");
        let status = std::process::Command::new("openssl")
            .args([
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-days",
                "1",
                "-subj",
                "/CN=localhost",
                "-addext",
                "subjectAltName=DNS:localhost",
                "-addext",
                "extendedKeyUsage=serverAuth",
                "-addext",
                "basicConstraints=critical,CA:FALSE",
                "-keyout",
            ])
            .arg(&key)
            .arg("-out")
            .arg(&cert)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(status.success());
        let script = r#"import ssl,sys,time,hashlib,base64,urllib.parse
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_GET(self):
  auth=self.headers.get('Authorization','').encode()
  if self.path == '/v1/redirect':
   self.send_response(302); self.send_header('Location','/v1/echo'); self.end_headers(); return
  if self.path == '/v1/slow': time.sleep(2)
  body=hashlib.sha256(auth).hexdigest().encode()
  if self.path == '/v1/echo': body=auth
  if self.path == '/v1/base64': body=base64.b64encode(auth.removeprefix(b'Bearer '))
  if self.path == '/v1/encoded': body=urllib.parse.quote_from_bytes(auth.removeprefix(b'Bearer '),safe='').encode()
  if self.path == '/v1/large': body=b'x'*(1048576+1)
  self.send_response(200); self.send_header('Content-Length',str(len(body))); self.end_headers()
  try: self.wfile.write(body)
  except (BrokenPipeError,ssl.SSLError): pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); context.load_cert_chain(sys.argv[1],sys.argv[2])
server.socket=context.wrap_socket(server.socket,server_side=True)
print(server.server_port,flush=True)
server.serve_forever()
"#;
        let mut server = tokio::process::Command::new("python3")
            .args(["-u", "-c", script])
            .arg(&cert)
            .arg(&key)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let mut stdout = tokio::io::BufReader::new(server.stdout.take().unwrap());
        let mut port = String::new();
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            stdout.read_line(&mut port),
        )
        .await
        .unwrap()
        .unwrap();
        let client = reqwest::Client::builder()
            .add_root_certificate(
                reqwest::Certificate::from_pem(&std::fs::read(&cert).unwrap()).unwrap(),
            )
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap();
        client
            .get(format!("https://localhost:{}/v1/hash", port.trim()))
            .send()
            .await
            .expect("local HTTPS fixture must be reachable with its test certificate");
        let store = Arc::new(Store::open(temp.path()).unwrap());
        struct Cleanup(String);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = super::super::delete_keychain(&self.0);
            }
        }
        let _cleanup = Cleanup(store.service.clone());
        let project = uuid::Uuid::new_v4().to_string();
        let secret = format!("relay-test-{}+/=", uuid::Uuid::new_v4());
        let info = store
            .apply(super::super::Command::Save {
                project_id: project.clone(),
                id: None,
                expected_revision: None,
                name: "HTTPS fixture".into(),
                secret: secret.clone(),
            })
            .unwrap()
            .unwrap();
        let binding = ToolConnection {
            id: info.id.clone(),
            base_url: format!("https://localhost:{}/v1/", port.trim()),
            header: "Authorization".into(),
            prefix: "Bearer ".into(),
        };
        let requests = BTreeMap::from([("SERVICE".into(), binding)]);
        let approved = BTreeMap::from([("SERVICE".into(), info.clone())]);
        let relay = Relay::with_client(
            store.clone(),
            &project,
            requests.clone(),
            approved.clone(),
            client.clone(),
        )
        .await
        .unwrap();
        let request_url = |path: &str| {
            format!(
                "{}/SERVICE?path={}",
                relay.url,
                percent_encoding::utf8_percent_encode(path, percent_encoding::NON_ALPHANUMERIC)
            )
        };
        let response = client.get(request_url("hash")).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.text().await.unwrap(),
            crate::project_store::hash(format!("Bearer {secret}").as_bytes())
        );
        for path in [
            "echo",
            "base64",
            "encoded",
            "redirect",
            "large",
            "../outside",
        ] {
            let response = client.get(request_url(path)).send().await.unwrap();
            assert_eq!(response.status(), StatusCode::BAD_GATEWAY, "{path}");
            assert!(!response.text().await.unwrap().contains(&secret));
        }
        assert_eq!(
            client
                .post(request_url("hash"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::METHOD_NOT_ALLOWED
        );
        assert_eq!(
            client
                .get(request_url("hash"))
                .header("origin", "https://untrusted.example")
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        let unknown = format!("{}/UNKNOWN?path=hash", relay.url);
        assert_eq!(
            client.get(unknown).send().await.unwrap().status(),
            StatusCode::NOT_FOUND
        );
        store
            .apply(super::super::Command::Save {
                project_id: project.clone(),
                id: Some(info.id),
                expected_revision: Some(info.revision),
                name: "HTTPS fixture".into(),
                secret: "rotated-test-key".into(),
            })
            .unwrap();
        assert_eq!(
            client
                .get(request_url("hash"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_GATEWAY
        );
        assert!(
            Relay::with_client(
                store.clone(),
                &project,
                requests.clone(),
                approved,
                client.clone()
            )
            .await
            .is_err()
        );
        drop(relay);
        let current = store.list(&project).unwrap().remove(0);
        let relay = Relay::with_client(
            store,
            &project,
            requests,
            BTreeMap::from([("SERVICE".into(), current)]),
            client.clone(),
        )
        .await
        .unwrap();
        let url = format!("{}/SERVICE?path=slow", relay.url);
        let after = url.clone();
        let request_client = client.clone();
        let pending = tokio::spawn(async move { request_client.get(url).send().await });
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        drop(relay);
        if let Ok(response) = pending.await.unwrap() {
            assert!(!response.status().is_success());
        }
        assert!(client.get(after).send().await.is_err());
        server.kill().await.unwrap();
        let _ = server.wait().await;
    }
}
