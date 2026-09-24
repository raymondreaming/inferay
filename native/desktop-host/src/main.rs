use std::{
    net::{Ipv4Addr, SocketAddr},
    path::PathBuf,
};

use inferay_server::{ServerConfig, ServerHandle};
use tao::{
    dpi::{LogicalPosition, LogicalSize},
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    window::WindowBuilder,
};
use url::Url;
use wry::{NewWindowResponse, WebViewBuilder};

#[cfg(target_os = "macos")]
use tao::platform::macos::{WindowBuilderExtMacOS, WindowExtMacOS};

#[cfg(target_os = "macos")]
use {
    objc2::{MainThreadMarker, runtime::Sel, sel},
    objc2_app_kit::{
        NSAppearance, NSAppearanceCustomization, NSAppearanceNameVibrantDark, NSApplication,
        NSAutoresizingMaskOptions, NSMenu, NSMenuItem, NSVisualEffectBlendingMode,
        NSVisualEffectMaterial, NSVisualEffectState, NSVisualEffectView, NSWindow,
        NSWindowOrderingMode, NSWorkspace,
    },
    objc2_foundation::{NSString, NSURL},
};

const INITIALIZATION_SCRIPT: &str = r#"
window.inferayNativeGlass = navigator.platform.startsWith('Mac');
document.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const noDrag = target.closest('.inferay-app-region-no-drag');
  const drag = target.closest('.inferay-app-region-drag');
  const interactive = target.closest(
    'button, a, input, textarea, select, summary, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="radio"], [contenteditable="true"], [draggable="true"], [data-workspace-dock-drag-source="true"]'
  );
  if (!noDrag && !interactive && drag) {
    window.ipc.postMessage(event.detail === 2 ? 'toggle_maximize' : 'drag_window');
  }
});
window.addEventListener('resize', () => window.ipc.postMessage('sync_fullscreen'));
"#;

#[cfg(target_os = "macos")]
fn add_menu_item(
    menu: &NSMenu,
    marker: MainThreadMarker,
    title: &str,
    action: Option<Sel>,
    shortcut: &str,
) {
    let item = unsafe {
        NSMenuItem::initWithTitle_action_keyEquivalent(
            marker.alloc(),
            &NSString::from_str(title),
            action,
            &NSString::from_str(shortcut),
        )
    };
    menu.addItem(&item);
}

#[cfg(target_os = "macos")]
fn install_application_menu() {
    let marker = MainThreadMarker::new().expect("macOS application menu requires the main thread");
    let main_menu = NSMenu::initWithTitle(marker.alloc(), &NSString::from_str(""));

    let app_menu = NSMenu::initWithTitle(marker.alloc(), &NSString::from_str("Inferay"));
    add_menu_item(
        &app_menu,
        marker,
        "Quit Inferay",
        Some(sel!(terminate:)),
        "q",
    );
    let app_menu_item = unsafe {
        NSMenuItem::initWithTitle_action_keyEquivalent(
            marker.alloc(),
            &NSString::from_str("Inferay"),
            None,
            &NSString::from_str(""),
        )
    };
    app_menu_item.setSubmenu(Some(&app_menu));
    main_menu.addItem(&app_menu_item);

    let edit_menu = NSMenu::initWithTitle(marker.alloc(), &NSString::from_str("Edit"));
    add_menu_item(&edit_menu, marker, "Cut", Some(sel!(cut:)), "x");
    add_menu_item(&edit_menu, marker, "Copy", Some(sel!(copy:)), "c");
    add_menu_item(&edit_menu, marker, "Paste", Some(sel!(paste:)), "v");
    edit_menu.addItem(&NSMenuItem::separatorItem(marker));
    add_menu_item(
        &edit_menu,
        marker,
        "Select All",
        Some(sel!(selectAll:)),
        "a",
    );
    let edit_menu_item = unsafe {
        NSMenuItem::initWithTitle_action_keyEquivalent(
            marker.alloc(),
            &NSString::from_str("Edit"),
            None,
            &NSString::from_str(""),
        )
    };
    edit_menu_item.setSubmenu(Some(&edit_menu));
    main_menu.addItem(&edit_menu_item);

    NSApplication::sharedApplication(marker).setMainMenu(Some(&main_menu));
}

#[derive(Debug)]
enum UserEvent {
    DragWindow,
    ToggleMaximize,
    SyncFullscreen,
    SetBackdrop(f64),
}

fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .expect("desktop host must live under native/desktop-host")
        .to_path_buf()
}

fn bundled_app_root() -> Option<PathBuf> {
    let executable = std::env::current_exe().ok()?;
    let macos_dir = executable.parent()?;
    let resources_dir = macos_dir.parent()?.join("Resources");
    resources_dir.is_dir().then_some(resources_dir)
}

fn start_server() -> Result<ServerHandle, String> {
    let app_root = bundled_app_root().unwrap_or_else(project_root);
    let dev_backend_addr = std::env::var("INFERAY_DEV_BACKEND_ADDR").ok();
    let listen_addr = if let Some(address) = dev_backend_addr {
        address
            .parse::<SocketAddr>()
            .map_err(|error| format!("invalid Inferay development backend address: {error}"))?
    } else {
        (Ipv4Addr::LOCALHOST, 0).into()
    };
    let mut config = ServerConfig::new(listen_addr, app_root);
    config.live_reload = std::env::var_os("INFERAY_LIVE_RELOAD").is_some();
    ServerHandle::start(config)
}

fn external_server_addr() -> Result<Option<SocketAddr>, String> {
    std::env::var("INFERAY_EXTERNAL_BACKEND_ADDR")
        .ok()
        .map(|address| {
            address
                .parse::<SocketAddr>()
                .map_err(|error| format!("invalid Inferay backend address: {error}"))
        })
        .transpose()
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

fn is_app_navigation(url: &str, origin: &url::Origin) -> bool {
    Url::parse(url).is_ok_and(|url| &url.origin() == origin)
}

fn open_external_link(url: &str) {
    let Ok(url) = Url::parse(url) else { return };
    if !matches!(url.scheme(), "http" | "https" | "mailto") {
        return;
    }
    #[cfg(target_os = "macos")]
    if let Some(url) = NSURL::URLWithString(&NSString::from_str(url.as_str()))
        && !NSWorkspace::sharedWorkspace().openURL(&url)
    {
        eprintln!("Unable to open link in its default application");
    }
    #[cfg(not(target_os = "macos"))]
    {
        let opener = if cfg!(target_os = "windows") {
            "explorer.exe"
        } else {
            "xdg-open"
        };
        // Reap the opener away from the UI thread; no shell interprets the URL.
        std::thread::spawn(move || {
            if let Err(error) = std::process::Command::new(opener)
                .arg(url.as_str())
                .status()
            {
                eprintln!("Unable to open link: {error}");
            }
        });
    }
}

#[test]
fn only_the_backend_origin_navigates_inside_inferay() {
    let origin = Url::parse("http://127.0.0.1:4317").unwrap().origin();
    for url in [
        "http://127.0.0.1:4317/",
        "http://127.0.0.1:4317/chat#message",
    ] {
        assert!(is_app_navigation(url, &origin));
    }
    for url in [
        "https://linear.app/aivre",
        "http://127.0.0.1:43170/",
        "http://127.0.0.1:4317@evil.example/",
        "javascript:alert(1)",
        "file:///etc/hosts",
    ] {
        assert!(!is_app_navigation(url, &origin));
    }
}

#[cfg(target_os = "macos")]
fn install_window_backdrop(
    window: &tao::window::Window,
) -> objc2::rc::Retained<NSVisualEffectView> {
    let marker = MainThreadMarker::new().expect("window backdrop requires the main thread");
    // Wry replaces Tao's content view. Resolve the final NSWindow content view
    // after WebView::build; Tao's original ns_view is no longer in the window.
    let native_window = unsafe { &*window.ns_window().cast::<NSWindow>() };
    let content = native_window
        .contentView()
        .expect("window has a content view");
    let backdrop = NSVisualEffectView::initWithFrame(marker.alloc(), content.bounds());
    // Inferay stays dark even when the system appearance is light.
    backdrop.setAppearance(
        NSAppearance::appearanceNamed(unsafe { NSAppearanceNameVibrantDark }).as_deref(),
    );
    // A window backdrop should not carry the opaque gray tint of a sidebar.
    backdrop.setMaterial(NSVisualEffectMaterial::UnderWindowBackground);
    backdrop.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
    // Keep the desktop blurred when the user moves focus to another window.
    backdrop.setState(NSVisualEffectState::Active);
    backdrop.setAlphaValue(0.0);
    backdrop.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
    );
    content.addSubview_positioned_relativeTo(&backdrop, NSWindowOrderingMode::Below, None);
    backdrop
}

fn main() -> wry::Result<()> {
    let external_addr = external_server_addr().expect("unable to read Inferay backend address");
    let mut server = if external_addr.is_some() {
        None
    } else {
        Some(start_server().expect("unable to start inferay Rust services"))
    };
    let server_addr = external_addr.unwrap_or_else(|| {
        server
            .as_ref()
            .expect("embedded Inferay server must be running")
            .local_addr()
    });
    let renderer_url = format!("http://{server_addr}");
    let renderer_origin = Url::parse(&renderer_url)
        .expect("valid backend URL")
        .origin();

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();

    #[cfg(target_os = "macos")]
    install_application_menu();

    let window_builder = WindowBuilder::new()
        .with_title("inferay")
        .with_transparent(true)
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

    #[cfg(target_os = "windows")]
    let _ = window_vibrancy::apply_acrylic(&window, Some((0, 0, 0, 150)));

    let proxy = event_loop.create_proxy();
    let webview = WebViewBuilder::new()
        .with_url(renderer_url)
        .with_navigation_handler(move |url| {
            if is_app_navigation(&url, &renderer_origin) {
                return true;
            }
            open_external_link(&url);
            false
        })
        .with_new_window_req_handler(|url, _| {
            open_external_link(&url);
            NewWindowResponse::Deny
        })
        .with_transparent(true)
        .with_devtools(cfg!(debug_assertions))
        .with_initialization_script(INITIALIZATION_SCRIPT)
        .with_accept_first_mouse(true)
        .with_clipboard(true)
        .with_ipc_handler(move |request| {
            let event = match request.body().as_str() {
                "drag_window" => Some(UserEvent::DragWindow),
                "toggle_maximize" => Some(UserEvent::ToggleMaximize),
                "sync_fullscreen" => Some(UserEvent::SyncFullscreen),
                message => message
                    .strip_prefix("window_backdrop:")
                    .and_then(|value| value.parse::<f64>().ok())
                    .filter(|value| value.is_finite())
                    .map(|value| UserEvent::SetBackdrop(value.clamp(0.0, 1.0))),
            };
            if let Some(event) = event {
                let _ = proxy.send_event(event);
            }
        })
        .build(&window)?;

    #[cfg(target_os = "macos")]
    let backdrop = install_window_backdrop(&window);

    sync_fullscreen(&window, &webview);
    let mut webview = Some(webview);

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                // Release the browser and its upgraded `/ws` connection before
                // waiting for Axum's graceful shutdown.
                webview.take();
                if let Some(server) = server.as_mut() {
                    server.shutdown();
                }
                *control_flow = ControlFlow::Exit;
            }
            Event::UserEvent(UserEvent::DragWindow) => {
                let _ = window.drag_window();
            }
            Event::UserEvent(UserEvent::ToggleMaximize) => {
                window.set_maximized(!window.is_maximized());
                if let Some(webview) = webview.as_ref() {
                    sync_fullscreen(&window, webview);
                }
            }
            Event::UserEvent(UserEvent::SyncFullscreen) => {
                if let Some(webview) = webview.as_ref() {
                    sync_fullscreen(&window, webview);
                }
            }
            Event::UserEvent(UserEvent::SetBackdrop(strength)) => {
                #[cfg(target_os = "macos")]
                // Higher window transparency reveals some desktop detail while
                // retaining at least 65% of the native window material.
                backdrop.setAlphaValue(if strength > 0.0 {
                    0.65 + 0.35 * strength
                } else {
                    0.0
                });
                #[cfg(not(target_os = "macos"))]
                let _ = strength;
            }
            _ => {}
        }
    });
}
