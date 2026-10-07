//! Bounded stdio MCP calls inside the normal approved tool process boundary.
use super::*;
use tokio::io::{AsyncBufReadExt, BufReader};

const LIMIT: u64 = 1_048_576;
pub(super) struct Call<'a> {
    pub id: &'a str,
    pub active: Option<&'a AtomicBool>,
    pub name: &'a str,
    pub input: &'a Value,
    pub logs: &'a Path,
    pub timeout: Duration,
}

pub(super) async fn execute(
    runtime: &ProjectRuntime,
    child: &mut tokio::process::Child,
    process: &mut ToolProcess<'_>,
    call: Call<'_>,
) -> Result<Value> {
    let stdin = child.stdin.take().ok_or("MCP stdin missing")?;
    let stdout = child.stdout.take().ok_or("MCP stdout missing")?;
    let stderr = child.stderr.take().ok_or("MCP stderr missing")?;
    let error_path = call.logs.join("stderr.txt");
    let mut errors = tokio::spawn(async move {
        let mut data = Vec::new();
        stderr.take(LIMIT + 1).read_to_end(&mut data).await?;
        tokio::fs::write(error_path, &data).await?;
        Ok::<_, std::io::Error>(data.len())
    });
    let mut result = {
        let exchange = async {
            let mut client = Client {
                stdin,
                stdout: BufReader::new(stdout).take(LIMIT + 1),
                log: tokio::fs::File::create(call.logs.join("stdout.txt")).await?,
                request_id: 0,
                messages: 0,
            };
            client.call(call.name, call.input).await
        };
        tokio::pin!(exchange);
        let deadline = tokio::time::Instant::now() + call.timeout;
        loop {
            tokio::select! {
                result = &mut exchange => break result,
                _ = tokio::time::sleep(Duration::from_millis(100)) => {
                    if runtime.stopped(call.id) || call.active.is_some_and(|flag| !flag.load(Ordering::Acquire)) {
                        break Err("Cancelled".into());
                    }
                    if tokio::time::Instant::now() >= deadline {
                        break Err("MCP tool timed out".into());
                    }
                }
            }
        }
    }; // Close stdin before waiting for normal MCP shutdown.
    let status = tokio::time::timeout(Duration::from_millis(250), child.wait()).await;
    if let Ok(Ok(status)) = &status {
        process.exited = true;
        if !status.success() && result.is_ok() {
            result = Err(format!("MCP server exited with {status}").into());
        }
    }
    process.stop();
    let _ = child.kill().await;
    let _ = child.wait().await;
    match tokio::time::timeout(Duration::from_secs(2), &mut errors).await {
        Ok(size) => {
            if size?? > LIMIT as usize {
                return Err("MCP stderr exceeded 1 MiB".into());
            }
        }
        Err(_) => {
            errors.abort();
            return Err("MCP stderr did not close".into());
        }
    }
    result
}

struct Client {
    stdin: tokio::process::ChildStdin,
    stdout: tokio::io::Take<BufReader<tokio::process::ChildStdout>>,
    log: tokio::fs::File,
    request_id: u32,
    messages: u32,
}
impl Client {
    async fn send(&mut self, value: Value) -> Result<()> {
        self.stdin
            .write_all(format!("{value}\n").as_bytes())
            .await?;
        self.stdin.flush().await?;
        Ok(())
    }
    async fn request(&mut self, method: &str, params: Value) -> Result<Value> {
        self.request_id += 1;
        let id = self.request_id;
        self.send(json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))
            .await?;
        loop {
            let mut line = Vec::new();
            if self.stdout.read_until(b'\n', &mut line).await? == 0 {
                return Err("MCP server closed stdout before replying".into());
            }
            self.log.write_all(&line).await?;
            if self.stdout.limit() == 0 {
                return Err("MCP stdout exceeded 1 MiB".into());
            }
            self.messages += 1;
            if self.messages > 1000 {
                return Err("MCP message limit exceeded".into());
            }
            let message: Value =
                serde_json::from_slice(&line).map_err(|_| "MCP server returned invalid JSON")?;
            if message["jsonrpc"] != "2.0" {
                return Err("MCP server returned an invalid JSON-RPC version".into());
            }
            if let Some(method) = message["method"].as_str() {
                if let Some(id) = message.get("id") {
                    // Servers cannot acquire model, user-input or filesystem authority.
                    let reply = if method == "ping" {
                        json!({"result":{}})
                    } else {
                        json!({"error":{"code":-32601,"message":"Client capability is not available"}})
                    };
                    let mut reply = reply;
                    reply["jsonrpc"] = json!("2.0");
                    reply["id"] = id.clone();
                    self.send(reply).await?;
                }
                continue;
            }
            if message["id"] != id {
                return Err("MCP response ID does not match the request".into());
            }
            if message.get("error").is_some() {
                return Err(format!(
                    "MCP {method} failed; inspect stdout.txt for the server response"
                )
                .into());
            }
            return message
                .get("result")
                .cloned()
                .filter(Value::is_object)
                .ok_or_else(|| "MCP response result must be an object".into());
        }
    }
    async fn call(&mut self, name: &str, input: &Value) -> Result<Value> {
        let initialized = self.request("initialize", json!({"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"inferay","version":env!("CARGO_PKG_VERSION")}})).await?;
        if !matches!(
            initialized["protocolVersion"].as_str(),
            Some("2024-11-05" | "2025-03-26" | "2025-06-18")
        ) {
            return Err("MCP server selected an unsupported protocol version".into());
        }
        if !initialized["capabilities"]["tools"].is_object() {
            return Err("MCP server does not support tools".into());
        }
        self.send(json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
            .await?;
        let mut cursor = None;
        let mut found = false;
        for _ in 0..32 {
            let page = self
                .request(
                    "tools/list",
                    cursor
                        .as_ref()
                        .map_or_else(|| json!({}), |cursor| json!({"cursor":cursor})),
                )
                .await?;
            let tools = page["tools"]
                .as_array()
                .ok_or("MCP tools/list did not return tools")?;
            if let Some(tool) = tools.iter().find(|tool| tool["name"] == name) {
                if !tool["inputSchema"].is_object() || tool["inputSchema"]["type"] != "object" {
                    return Err("MCP tool inputSchema must describe an object".into());
                }
                validate_json(&tool["inputSchema"], input)?;
                found = true;
                break;
            }
            let next = page["nextCursor"].as_str().map(str::to_owned);
            if next.is_none() {
                break;
            }
            if next == cursor {
                return Err("MCP tools/list repeated its cursor".into());
            }
            cursor = next;
        }
        if !found {
            return Err(format!("MCP server did not provide the declared tool '{name}'").into());
        }
        let result = self
            .request("tools/call", json!({"name":name,"arguments":input}))
            .await?;
        if result["isError"] == true {
            return Err("MCP tool reported failure; inspect stdout.txt for its findings".into());
        }
        if !result["content"].is_array() {
            return Err("MCP tool returned invalid content".into());
        }
        Ok(result)
    }
}
