#[cfg(target_os = "macos")]
pub fn install_window_material(window: &rune::WindowHandle) {
    use objc2::msg_send_id;
    use objc2::rc::Retained;
    use objc2_app_kit::{
        NSAppearance, NSAppearanceCustomization, NSAppearanceNameDarkAqua,
        NSAutoresizingMaskOptions, NSView, NSVisualEffectBlendingMode, NSVisualEffectMaterial,
        NSVisualEffectState, NSVisualEffectView, NSWindowOrderingMode,
    };
    use objc2_foundation::MainThreadMarker;
    use rune::raw_window_handle::RawWindowHandle;
    let _ = window.with_raw_handle(|handle| {
        let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
            return;
        };
        let Some(marker) = MainThreadMarker::new() else {
            return;
        };
        unsafe {
            let view: &NSView = handle.ns_view.cast().as_ref();
            let Some(window) = view.window() else {
                return;
            };
            if let Some(dark) = NSAppearance::appearanceNamed(NSAppearanceNameDarkAqua) {
                window.setAppearance(Some(&dark));
            }
            let Some(content) = window.contentView() else {
                return;
            };
            let Some(frame) = content.superview() else {
                return;
            };
            let effect: Retained<NSVisualEffectView> =
                msg_send_id![marker.alloc::<NSVisualEffectView>(), initWithFrame: frame.bounds()];
            effect.setMaterial(NSVisualEffectMaterial::UnderWindowBackground);
            effect.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
            effect.setState(NSVisualEffectState::Active);
            effect.setAutoresizingMask(
                NSAutoresizingMaskOptions::NSViewWidthSizable
                    | NSAutoresizingMaskOptions::NSViewHeightSizable,
            );
            frame.addSubview_positioned_relativeTo(
                &effect,
                NSWindowOrderingMode::NSWindowBelow,
                Some(&content),
            );
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub fn install_window_material(_window: &rune::WindowHandle) {}

pub struct PathPrompt {
    pub files: bool,
    pub directories: bool,
    pub multiple: bool,
    pub prompt: Option<&'static str>,
}

#[cfg(target_os = "macos")]
pub fn prompt_for_paths(
    options: PathPrompt,
    done: impl FnOnce(&mut crate::workspace::Workspace, Option<Vec<std::path::PathBuf>>, &mut rune::Tx)
    + Send
    + 'static,
) {
    use objc2_app_kit::{NSModalResponse, NSModalResponseOK, NSOpenPanel};
    use objc2_foundation::{MainThreadMarker, NSString};
    let Some(marker) = MainThreadMarker::new() else {
        return;
    };
    unsafe {
        let panel = NSOpenPanel::openPanel(marker);
        panel.setCanChooseDirectories(options.directories);
        panel.setCanChooseFiles(options.files);
        panel.setAllowsMultipleSelection(options.multiple);
        panel.setCanCreateDirectories(true);
        panel.setResolvesAliases(false);
        if let Some(prompt) = options.prompt {
            panel.setPrompt(Some(&NSString::from_str(prompt)));
        }
        let done = std::cell::Cell::new(Some(done));
        let chosen = panel.clone();
        let handler = block2::RcBlock::new(move |response: NSModalResponse| {
            let Some(done) = done.take() else {
                return;
            };
            let paths = (response == NSModalResponseOK).then(|| {
                chosen
                    .URLs()
                    .iter()
                    .filter(|url| url.isFileURL())
                    .filter_map(|url| {
                        url.path()
                            .map(|path| std::path::PathBuf::from(path.to_string()))
                    })
                    .collect::<Vec<_>>()
            });
            crate::task::update(move |s, tx| done(s, paths, tx));
        });
        panel.beginWithCompletionHandler(&handler);
    }
}

#[cfg(not(target_os = "macos"))]
pub fn prompt_for_paths(
    _options: PathPrompt,
    done: impl FnOnce(&mut crate::workspace::Workspace, Option<Vec<std::path::PathBuf>>, &mut rune::Tx)
    + Send
    + 'static,
) {
    crate::task::update(move |s, tx| done(s, None, tx));
}
