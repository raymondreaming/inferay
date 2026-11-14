use std::cell::Cell;

pub const TITLEBAR_HEIGHT: f32 = 38.;
pub const NATIVE_TITLEBAR_MIN_HEIGHT: f32 = 42.;

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
    pub fn factor(self) -> f32 {
        f32::from(self.0) / 100.
    }
    pub fn titlebar_height(self) -> f32 {
        (TITLEBAR_HEIGHT * self.factor()).max(NATIVE_TITLEBAR_MIN_HEIGHT)
    }
}

thread_local! {
    static FACTOR: Cell<f32> = const { Cell::new(1.) };
    static SCALE: Cell<f32> = const { Cell::new(2.) };
}

pub fn set_scale(scale: f32) {
    SCALE.set(scale.max(1.));
}

pub fn snap(value: f32) -> f32 {
    let scale = SCALE.get();
    (value * scale - 0.5).ceil().max(0.) / scale
}

pub fn apply(zoom: Zoom) {
    FACTOR.set(zoom.factor());
}

pub fn factor() -> f32 {
    FACTOR.get()
}

pub fn ui(value: f32) -> f32 {
    value * FACTOR.get()
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
