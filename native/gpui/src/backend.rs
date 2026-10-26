//! Loopback transport to the same application services used by the desktop host.
use anyhow::{Context, Result, bail};
use reqwest::{Client, Method, header};
use serde_json::Value;
use std::{
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, LazyLock},
};

pub static RUNTIME: LazyLock<tokio::runtime::Runtime> =
    LazyLock::new(|| tokio::runtime::Runtime::new().expect("native application runtime"));

pub struct Backend {
    // An external backend is owned by its host; an embedded backend ends with this app.
    _server: Option<inferay_server::ServerHandle>,
    client: Client,
    origin: String,
    auth: header::HeaderValue,
}
impl Backend {
    pub async fn connect(profile: PathBuf) -> Result<Arc<Self>> {
        let client = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(45))
            .build()?;
        let (server, address, token) = if let Ok(address) =
            std::env::var("INFERAY_EXTERNAL_BACKEND_ADDR")
        {
            let address: SocketAddr = address.parse().context("Invalid backend address")?;
            if !address.ip().is_loopback() {
                bail!("Inferay services must use a loopback address");
            }
            (None, address, None)
        } else {
            // Shipping hosts predating the profile lock may still own live agents.
            // Never let this preview's orphan cleanup terminate those processes.
            if let Ok(bytes) = tokio::fs::read(profile.join("runtime-pids.json")).await
                && let Ok(pids) = serde_json::from_slice::<Vec<u32>>(&bytes)
            {
                for pid in pids.into_iter().filter(|pid| *pid > 0) {
                    if tokio::process::Command::new("/bin/kill")
                        .args(["-0", &pid.to_string()])
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .status()
                        .await
                        .is_ok_and(|status| status.success())
                    {
                        bail!(
                            "This profile has running agents. Set INFERAY_EXTERNAL_BACKEND_ADDR to the existing app's local backend before using the native preview."
                        );
                    }
                }
            }
            let bundled = std::env::current_exe()?
                .parent()
                .and_then(|p| p.parent())
                .map(|p| p.join("Resources"));
            let root = bundled
                .filter(|p| p.join("data/prompts.json").is_file())
                .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."));
            let mut config = inferay_server::ServerConfig::new("127.0.0.1:0".parse()?, root);
            config.user_data_dir = profile;
            let token = config.auth_token.clone();
            let server = inferay_server::ServerHandle::start(config).map_err(anyhow::Error::msg)?;
            let address = server.local_addr();
            (Some(server), address, Some(token))
        };
        let origin = format!("http://{address}");
        let auth = if let Some(token) = token {
            header::HeaderValue::from_str(&token)?
        } else {
            let response = client.get(&origin).send().await?.error_for_status()?;
            let token = response
                .headers()
                .get_all(header::SET_COOKIE)
                .iter()
                .filter_map(|v| v.to_str().ok())
                .find_map(|cookie| {
                    cookie
                        .strip_prefix("inferay_local_auth=")
                        .and_then(|s| s.split(';').next())
                })
                .context("The local backend did not provide an authentication cookie")?;
            header::HeaderValue::from_str(token)?
        };
        Ok(Arc::new(Self {
            _server: server,
            client,
            origin,
            auth,
        }))
    }
    pub async fn chat_socket(
        &self,
    ) -> Result<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    > {
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        let mut request =
            format!("{}/ws", self.origin.replacen("http:", "ws:", 1)).into_client_request()?;
        request
            .headers_mut()
            .insert(header::ORIGIN, self.origin.parse()?);
        request
            .headers_mut()
            .insert("x-inferay-auth", self.auth.clone());
        let (socket, _) = tokio::time::timeout(
            std::time::Duration::from_secs(15),
            tokio_tungstenite::connect_async(request),
        )
        .await??;
        Ok(socket)
    }
    pub async fn upload_background(&self, path: PathBuf) -> Result<Value> {
        self.upload_image(path, "/api/config/background-image").await
    }
    pub async fn upload_image(&self, path: PathBuf, endpoint: &str) -> Result<Value> {
        let mime = match path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str()
        {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "webp" => "image/webp",
            "gif" => "image/gif",
            _ => bail!("Choose a PNG, JPEG, WebP, or GIF image"),
        };
        if tokio::fs::metadata(&path).await?.len() > 20 * 1024 * 1024 {
            bail!("Image must be 20 MB or smaller");
        }
        let file = reqwest::multipart::Part::bytes(tokio::fs::read(&path).await?)
            .file_name(path.file_name().unwrap().to_string_lossy().into_owned())
            .mime_str(mime)?;
        let response = self
            .client
            .post(format!("{}{endpoint}", self.origin))
            .header(header::ORIGIN, &self.origin)
            .header("x-inferay-auth", self.auth.clone())
            .multipart(reqwest::multipart::Form::new().part("file", file))
            .send()
            .await?;
        Self::response(response).await
    }
    pub async fn request(&self, method: Method, path: &str, body: Option<Value>) -> Result<Value> {
        if !path.starts_with("/api/") || path.contains('#') {
            bail!("Invalid application endpoint");
        }
        let mut request = self
            .client
            .request(method, format!("{}{path}", self.origin))
            .header(header::ORIGIN, &self.origin)
            .header("x-inferay-auth", self.auth.clone());
        if let Some(body) = body {
            request = request
                .header(header::CONTENT_TYPE, "application/json")
                .body(body.to_string());
        }
        let response = request
            .send()
            .await
            .context("Could not reach Inferay services")?;
        Self::response(response).await
    }
    async fn response(response: reqwest::Response) -> Result<Value> {
        let status = response.status();
        let bytes = response.bytes().await?;
        let value: Value = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).context("Invalid response from Inferay services")?
        };
        if !status.is_success() || value["ok"] == false {
            bail!(
                "{}",
                value["error"]
                    .as_str()
                    .or_else(|| value["message"].as_str())
                    .unwrap_or(status.canonical_reason().unwrap_or("Request failed"))
            );
        }
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn chat_image_upload_preserves_bytes_and_rejects_unsupported_files() {
        let fixture = tempfile::tempdir().unwrap();
        let mut config = inferay_server::ServerConfig::new("127.0.0.1:0".parse().unwrap(), fixture.path().into());
        config.user_data_dir = fixture.path().join("profile");
        let auth = header::HeaderValue::from_str(&config.auth_token).unwrap();
        let server = inferay_server::ServerHandle::start(config).unwrap();
        let origin = format!("http://{}", server.local_addr());
        let source = fixture.path().join("attached.png");
        let pixels = image::RgbaImage::new(2, 2);
        pixels.save(&source).unwrap();
        RUNTIME.block_on(async {
            let backend = Backend { _server: Some(server), client: Client::builder().no_proxy().build().unwrap(), origin, auth };
            let result = backend.upload_image(source.clone(), "/api/upload-temp").await.unwrap();
            assert_eq!(std::fs::read(result["path"].as_str().unwrap()).unwrap(), std::fs::read(source).unwrap());
            assert!(backend.upload_image(fixture.path().join("invalid.txt"), "/api/upload-temp").await.is_err());
        });
    }

    #[test]
    fn settings_persist_through_authenticated_application_services() {
        let profile = tempfile::tempdir().unwrap();
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let mut config = inferay_server::ServerConfig::new("127.0.0.1:0".parse().unwrap(), root);
        config.user_data_dir = profile.path().into();
        let auth = header::HeaderValue::from_str(&config.auth_token).unwrap();
        let server = inferay_server::ServerHandle::start(config).unwrap();
        let mut duplicate = inferay_server::ServerConfig::new(
            "127.0.0.1:0".parse().unwrap(),
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."),
        );
        duplicate.user_data_dir = profile.path().into();
        assert!(
            inferay_server::ServerHandle::start(duplicate)
                .err()
                .unwrap()
                .contains("already running")
        );
        let origin = format!("http://{}", server.local_addr());
        RUNTIME.block_on(async {
            let backend = Backend { _server: Some(server), client: Client::builder().no_proxy().build().unwrap(), origin, auth };
            backend.request(Method::GET, "/api/client-storage", None).await.unwrap();
            backend.request(Method::POST, "/api/client-storage", Some(json!({"entries":{"inferay-app-font":"menlo"}}))).await.unwrap();
            let stored = backend.request(Method::GET, "/api/client-storage?key=inferay-app-font", None).await.unwrap();
            assert_eq!(stored["entries"]["inferay-app-font"], "menlo");
            backend.request(Method::POST, "/api/native/provider-config", Some(json!({"agentKind":"codex","model":"gpt-6-astra","reasoningLevel":"high"}))).await.unwrap();
            let providers = backend.request(Method::GET,"/api/native/provider-config",None).await.unwrap();
            assert_eq!(providers["defaults"]["reasoningLevel"],"high");
            backend.request(Method::PUT,"/api/agent-context",Some(json!({"scope":"global","paneId":"global-settings","instructions":"Temporary settings regression fixture","mode":"inherit"}))).await.unwrap();
            let context=backend.request(Method::GET,"/api/agent-context?paneId=global-settings",None).await.unwrap();
            assert_eq!(context["global"]["instructions"],"Temporary settings regression fixture");
            let skill = backend.request(Method::POST,"/api/prompts",Some(json!({"name":"Settings fixture","command":"settings-fixture","description":"Test only","promptTemplate":"Fixture instructions"}))).await.unwrap();
            let path=format!("/api/prompts/{}",skill["_id"].as_str().unwrap());
            backend.request(Method::PUT,&path,Some(json!({"description":"Updated fixture"}))).await.unwrap();
            let skills=backend.request(Method::GET,"/api/prompts",None).await.unwrap();
            assert!(skills.as_array().unwrap().iter().any(|p|p["description"]=="Updated fixture"));
            backend.request(Method::DELETE,&path,None).await.unwrap();
            let catalog=backend.request(Method::GET,"/api/databases",None).await.unwrap();
            assert!(catalog.as_array().unwrap().iter().any(|d|d["id"]=="client-storage"));
            let schema=backend.request(Method::GET,"/api/databases/schema?database=client-storage",None).await.unwrap();
            let table=schema["objects"].as_array().unwrap().iter().find(|o|o["kind"]=="table").unwrap()["name"].as_str().unwrap();
            let mut query=url::form_urlencoded::Serializer::new(String::new());
            query.append_pair("database","client-storage").append_pair("table",table);
            let rows=backend.request(Method::GET,&format!("/api/databases/rows?{}",query.finish()),None).await.unwrap();
            assert!(!rows["rows"].as_array().unwrap().is_empty());
            let rejected=backend.client.post(format!("{}/api/client-storage",backend.origin)).header(header::ORIGIN,&backend.origin).header(header::CONTENT_TYPE,"application/json").body("{}").send().await.unwrap();
            assert_eq!(rejected.status(),reqwest::StatusCode::FORBIDDEN);
            assert!(backend.request(Method::GET,"/api/databases/schema?database=outside-profile",None).await.is_err());
            use futures_util::{SinkExt, StreamExt};
            use tokio_tungstenite::tungstenite::Message;
            let workspace = backend.request(Method::POST, "/api/agent/state/initialize", Some(json!({}))).await.unwrap();
            let pane = workspace["state"]["groups"][0]["panes"][0]["id"].as_str().unwrap();
            let mut socket = backend.chat_socket().await.unwrap();
            socket.send(Message::Text(json!({"type":"chat:reconnect","paneId":pane}).to_string().into())).await.unwrap();
            tokio::time::timeout(std::time::Duration::from_secs(10), async {
                loop {
                    let frame = socket.next().await.unwrap().unwrap();
                    if let Message::Text(text) = frame {
                        let event: Value = serde_json::from_str(text.as_str()).unwrap();
                        if event["type"] == "chat:sync" {
                            assert_eq!(event["paneId"], pane);
                            assert_eq!(event["modelVersion"], 1);
                            assert!(event["messages"].is_array());
                            break;
                        }
                    }
                }
            }).await.unwrap();
            // A local command exercises publication without launching a provider.
            socket.send(Message::Text(json!({"type":"chat:send","paneId":pane,"agentKind":"codex","text":"/help"}).to_string().into())).await.unwrap();
            tokio::time::timeout(std::time::Duration::from_secs(10), async {
                loop {
                    let frame = socket.next().await.unwrap().unwrap();
                    if let Message::Text(text) = frame {
                        let event: Value = serde_json::from_str(text.as_str()).unwrap();
                        if event["transcriptUpdate"]["messages"].as_array().is_some_and(|messages| !messages.is_empty()) {
                            assert_eq!(event["paneId"], pane);
                            break;
                        }
                    }
                }
            }).await.unwrap();
            socket.close(None).await.unwrap();

        });
    }
}
