//! One scale for native typography, controls, layout, and custom drawing.
use gpui::{App, KeyBinding, Pixels, Rems, Window, actions, point, px, rems};

pub const TITLEBAR_HEIGHT: f32 = 38.;
pub const NATIVE_TITLEBAR_MIN_HEIGHT: f32 = 42.;

actions!(zoom, [ZoomIn, ZoomOut, ResetZoom]);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Zoom(u16);

impl Default for Zoom {
    fn default() -> Self {
        Self(100)
    }
}

impl Zoom {
    pub fn restore(stored: Option<&str>) -> Self {
        Self(
            stored
                .and_then(|value| value.parse().ok())
                .unwrap_or(100)
                .clamp(50, 200),
        )
    }
    pub fn percent(self) -> u16 {
        self.0
    }
    pub fn step(self, direction: i16) -> Self {
        Self((i32::from(self.0) + i32::from(direction) * 10).clamp(50, 200) as u16)
    }
    pub fn rem_size(self) -> Pixels {
        px(16. * f32::from(self.0) / 100.)
    }

    pub fn apply(self, window: &mut Window) {
        window.set_rem_size(self.rem_size());
        #[cfg(target_os = "macos")]
        {
            let height =
                (TITLEBAR_HEIGHT * f32::from(self.0) / 100.).max(NATIVE_TITLEBAR_MIN_HEIGHT);
            window.set_traffic_light_position(point(px(16.), px((height - 14.) / 2.)));
        }
    }
}

/// Design dimensions remain in logical pixels; GPUI resolves them using the
/// window's rem size. Measured bounds and pointer positions remain real pixels.
pub fn ui(value: f32) -> Rems {
    rems(value / 16.)
}
pub fn factor(window: &Window) -> f32 {
    f32::from(window.rem_size()) / 16.
}
pub fn pixels(value: f32, window: &Window) -> Pixels {
    px(value * factor(window))
}

pub fn bind(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("cmd-=", ZoomIn, None),
        KeyBinding::new("cmd-+", ZoomIn, None),
        KeyBinding::new("cmd-shift-=", ZoomIn, None),
        KeyBinding::new("cmd--", ZoomOut, None),
        KeyBinding::new("cmd-0", ResetZoom, None),
    ]);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zoom_restoration_and_steps_stay_within_native_layout_limits() {
        assert_eq!(Zoom::restore(None), Zoom::default());
        assert_eq!(Zoom::restore(Some("invalid")), Zoom::default());
        assert_eq!(Zoom::restore(Some("500")).percent(), 200);
        assert_eq!(Zoom::restore(Some("1")).percent(), 50);
        assert_eq!(Zoom::default().step(1).step(-1), Zoom::default());
        assert_eq!(Zoom::restore(Some("200")).step(1).percent(), 200);
        assert_eq!(Zoom::restore(Some("50")).step(-1).percent(), 50);
    }
}
