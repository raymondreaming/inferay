use rune::Color;

pub const CANVAS: u32 = 0x0d0d0d;
pub const SURFACE: u32 = 0x151515;
pub const RAISED: u32 = 0x1b1b1b;
pub const COMPOSER: u32 = (SURFACE << 8) | 0xe0;
pub const TEXT: u32 = 0xebebeb;
pub const CHAT_BODY: f32 = 12.0;
pub const INPUT_TEXT: f32 = 13.0;
pub const INPUT_LINE_HEIGHT: f32 = 20.0;
pub const CHAT_SMALL: f32 = 10.0;
pub const CHAT_DETAIL: f32 = 9.0;
pub const DIFF_ROW: f32 = 14.0;
pub const DIFF_TEXT: f32 = 10.0;
pub const DIFF_NUMBER: f32 = 9.0;
pub const DIFF_GUTTER: f32 = 26.0;
pub const GRAPH_LANES: &[&str] = &[
    "#1c97b5", "#0063f2", "#7f12b7", "#ba18ab", "#d00066", "#c40012", "#ed4e2f", "#f0c13a",
    "#76d33c", "#36c894",
];
pub const ADDED: u32 = 0x55d68b;
pub const MODIFIED: u32 = 0xe5a447;
pub const DELETED: u32 = 0xff6868;
pub const RENAMED: u32 = 0x7a8fb5;

pub const DIFF_ADDED_BACKGROUND: u32 = (ADDED << 8) | 0x18;
pub const DIFF_REMOVED_BACKGROUND: u32 = (DELETED << 8) | 0x18;

pub fn rgb(hex: u32) -> Color {
    rgba((hex << 8) | 0xff)
}

pub fn rgba(hex: u32) -> Color {
    let channel = |shift: u32| rune::color::srgb_decode(((hex >> shift) & 0xff) as f32 / 255.);
    Color {
        r: channel(24),
        g: channel(16),
        b: channel(8),
        a: (hex & 0xff) as f32 / 255.,
    }
}

pub fn hsla(h: f32, s: f32, l: f32, a: f32) -> Color {
    let h = h.rem_euclid(1.) * 6.;
    let c = (1. - (2. * l - 1.).abs()) * s;
    let x = c * (1. - (h % 2. - 1.).abs());
    let m = l - c / 2.;
    let (r, g, b) = match h as u32 {
        0 => (c, x, 0.),
        1 => (x, c, 0.),
        2 => (0., c, x),
        3 => (0., x, c),
        4 => (x, 0., c),
        _ => (c, 0., x),
    };
    let decode = |v: f32| rune::color::srgb_decode(v + m);
    Color {
        r: decode(r),
        g: decode(g),
        b: decode(b),
        a,
    }
}
