use std::cell::{Cell, RefCell};
use std::collections::HashMap;

thread_local! {
    static SANS: Cell<&'static str> = const { Cell::new("System Font") };
    static SCALE: Cell<f32> = const { Cell::new(2.) };
    static METRICS: RefCell<HashMap<&'static str, (f32, f32)>> = RefCell::new(HashMap::new());
}

pub fn set_frame(sans: &'static str, scale: f32) {
    SANS.set(sans);
    SCALE.set(scale.max(1.));
}

fn embedded(bytes: &[u8]) -> Option<(f32, f32)> {
    use skrifa::MetadataProvider;
    let font = skrifa::FontRef::new(bytes).ok()?;
    let metrics = font.metrics(
        skrifa::instance::Size::unscaled(),
        skrifa::instance::LocationRef::default(),
    );
    let units = metrics.units_per_em as f32;
    Some((metrics.ascent / units, -metrics.descent / units))
}

#[cfg(target_os = "macos")]
fn installed(family: &str) -> (f32, f32) {
    use objc2_core_foundation::CFString;
    use objc2_core_text::{CTFont, CTFontUIFontType};
    unsafe {
        let font = if family == "System Font" {
            CTFont::new_ui_font_for_language(CTFontUIFontType::System, 100., None)
        } else {
            Some(CTFont::with_name(
                &CFString::from_str(family),
                100.,
                std::ptr::null(),
            ))
        };
        font.map_or((0.966_796_9, 0.210_937_5), |font| {
            (font.ascent() as f32 / 100., font.descent() as f32 / 100.)
        })
    }
}

#[cfg(not(target_os = "macos"))]
fn installed(_family: &str) -> (f32, f32) {
    (0.966_796_9, 0.210_937_5)
}

fn metrics(family: &'static str) -> (f32, f32) {
    METRICS.with_borrow_mut(|cache| {
        *cache.entry(family).or_insert_with(|| match family {
            "Geist" => embedded(crate::FONTS[0]).unwrap_or((1.005, 0.295)),
            other => installed(other),
        })
    })
}

pub fn correction(size: f32, line_height: f32, mono: bool) -> f32 {
    let family = if mono { "Menlo" } else { SANS.get() };
    let (ascent, descent) = metrics(family);
    let scale = SCALE.get();
    let (size, line) = (size * scale, line_height * scale);
    let (ascent, descent) = (ascent * size, descent * size);
    let coretext = (line - ascent - descent) / 2. + ascent;
    let rune = ascent.round() + ((line - (ascent.round() + descent.round())) / 2.).floor();
    (coretext - rune) / scale
}
