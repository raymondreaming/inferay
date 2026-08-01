use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use tao::{
    dpi::{LogicalPosition, LogicalSize},
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    window::WindowBuilder,
};
use wry::WebViewBuilder;

#[cfg(target_os = "macos")]
use tao::platform::macos::WindowBuilderExtMacOS;

const SERVER_PORT_RANGE: std::ops::RangeInclusive<u16> = 4001..=4010;
const INITIALIZATION_SCRIPT: &str = r#"
document.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const noDrag = target.closest('.electrobun-webkit-app-region-no-drag');
  const drag = target.closest('.electrobun-webkit-app-region-drag');
  if (!noDrag && drag) {
    window.ipc.postMessage(event.detail === 2 ? 'toggle_maximize' : 'drag_window');
  }
});
window.addEventListener('resize', () => window.ipc.postMessage('sync_fullscreen'));
"#;

#[derive(Debug)]
enum UserEvent {
    DragWindow,
    ToggleMaximize,
    SyncFullscreen,
}

struct ServerProcess(Option<Child>);

impl ServerProcess {
    fn terminate(&mut self) {
        if let Some(mut child) = self.0.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for ServerProcess {
    fn drop(&mut self) {
        self.terminate();
    }
}

fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .expect("desktop host must live under native/desktop-host")
        .to_path_buf()
}

fn bundled_paths() -> Option<(PathBuf, PathBuf)> {
    let executable = std::env::current_exe().ok()?;
    let macos_dir = executable.parent()?;
    let resources_dir = macos_dir.parent()?.join("Resources");
    let server = macos_dir.join("inferay-server");
    (server.is_file() && resources_dir.is_dir()).then_some((server, resources_dir))
}

fn choose_server_port() -> Result<u16, String> {
    SERVER_PORT_RANGE
        .clone()
        .find(|port| TcpListener::bind((Ipv4Addr::LOCALHOST, *port)).is_ok())
        .ok_or_else(|| "no available inferay server port in 4001-4010".to_string())
}

fn start_server(port: u16) -> Result<ServerProcess, String> {
    let mut command = if let Some((server, resources)) = bundled_paths() {
        let mut command = Command::new(server);
        command.env("AGENT_GUI_APP_ROOT", resources);
        command
    } else {
        let mut command = Command::new("bun");
        command
            .args(["run", "src/server/standalone.ts"])
            .current_dir(project_root());
        command
    };

    command
        .env("AGENT_GUI_SERVER_PORT", port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map(|child| ServerProcess(Some(child)))
        .map_err(|error| format!("failed to launch inferay server: {error}"))
}

fn wait_for_server(port: u16) -> Result<(), String> {
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&address, Duration::from_millis(100)).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(50));
    }
    Err(format!("inferay server did not start on {address}"))
}

fn sync_fullscreen(window: &tao::window::Window, webview: &wry::WebView) {
    let value = if window.fullscreen().is_some() {
        "true"
    } else {
        "false"
    };
    let _ = webview.evaluate_script(&format!(
        "document.documentElement.dataset.inferayFullscreen = '{value}'"
    ));
}

fn main() -> wry::Result<()> {
    let server_port = choose_server_port().expect("unable to reserve an inferay server port");
    let mut server = start_server(server_port).expect("unable to start inferay services");
    wait_for_server(server_port).expect("inferay services failed to become ready");

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let window_builder = WindowBuilder::new()
        .with_title("inferay")
        .with_inner_size(LogicalSize::new(1440.0, 920.0))
        .with_position(LogicalPosition::new(120.0, 80.0));

    #[cfg(target_os = "macos")]
    let window_builder = window_builder
        .with_titlebar_transparent(true)
        .with_title_hidden(true)
        .with_fullsize_content_view(true);

    let window = window_builder
        .build(&event_loop)
        .expect("failed to open window");
    let proxy = event_loop.create_proxy();
    let webview = WebViewBuilder::new()
        .with_url(format!("http://127.0.0.1:{server_port}"))
        .with_initialization_script(INITIALIZATION_SCRIPT)
        .with_accept_first_mouse(true)
        .with_ipc_handler(move |request| {
            let event = match request.body().as_str() {
                "drag_window" => Some(UserEvent::DragWindow),
                "toggle_maximize" => Some(UserEvent::ToggleMaximize),
                "sync_fullscreen" => Some(UserEvent::SyncFullscreen),
                _ => None,
            };
            if let Some(event) = event {
                let _ = proxy.send_event(event);
            }
        })
        .build(&window)?;
    sync_fullscreen(&window, &webview);

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                server.terminate();
                *control_flow = ControlFlow::Exit;
            }
            Event::UserEvent(UserEvent::DragWindow) => {
                let _ = window.drag_window();
            }
            Event::UserEvent(UserEvent::ToggleMaximize) => {
                window.set_maximized(!window.is_maximized());
                sync_fullscreen(&window, &webview);
            }
            Event::UserEvent(UserEvent::SyncFullscreen) => sync_fullscreen(&window, &webview),
            _ => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::INITIALIZATION_SCRIPT;

    #[test]
    fn preserves_existing_renderer_drag_region_contract() {
        assert!(INITIALIZATION_SCRIPT.contains(".electrobun-webkit-app-region-drag"));
        assert!(INITIALIZATION_SCRIPT.contains(".electrobun-webkit-app-region-no-drag"));
        assert!(INITIALIZATION_SCRIPT.contains("event.detail === 2"));
        assert!(INITIALIZATION_SCRIPT.contains("toggle_maximize"));
        assert!(INITIALIZATION_SCRIPT.contains("drag_window"));
    }
}
