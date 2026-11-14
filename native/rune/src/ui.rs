use crate::colors::{self, rgba};
use crate::zoom::ui;
use rune::{Color, El, Family, Icon, Shadow, TextStyle, col, el, row, text};

pub const PHI: f32 = std::f32::consts::GOLDEN_RATIO;
pub const MEDIUM: f32 = 500.;
pub const SEMIBOLD: f32 = 600.;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Ink {
    pub size: f32,
    pub weight: f32,
    pub color: Color,
    pub line: Option<f32>,
    pub mono: bool,
    pub italic: bool,
}

impl Ink {
    pub fn new(size: f32) -> Self {
        Self {
            size,
            weight: 400.,
            color: colors::rgb(colors::TEXT),
            line: None,
            mono: false,
            italic: false,
        }
    }
    pub fn body() -> Self {
        Self::new(colors::CHAT_BODY)
    }
    pub fn small() -> Self {
        Self::new(colors::CHAT_SMALL)
    }
    pub fn detail() -> Self {
        Self::new(colors::CHAT_DETAIL)
    }
    pub fn size(self, size: f32) -> Self {
        Self { size, ..self }
    }
    pub fn weight(self, weight: f32) -> Self {
        Self { weight, ..self }
    }
    pub fn color(self, color: Color) -> Self {
        Self { color, ..self }
    }
    pub fn hex(self, hex: u32) -> Self {
        self.color(rgba(hex))
    }
    pub fn line(self, line: f32) -> Self {
        Self {
            line: Some(line),
            ..self
        }
    }
    pub fn mono(self) -> Self {
        Self { mono: true, ..self }
    }
    pub fn line_height(&self) -> f32 {
        crate::zoom::snap(ui(self.line.unwrap_or(self.size * PHI)))
    }
    pub fn style(&self) -> TextStyle {
        let mut style = TextStyle::new(ui(self.size), self.weight);
        style.line_height = self.line_height();
        if self.mono {
            style = style.family(Family::Mono);
        }
        if self.italic {
            style = style.italic();
        }
        style
    }
    pub fn baseline(&self) -> f32 {
        crate::baseline::correction(ui(self.size), self.line_height(), self.mono)
    }
    pub fn text(&self, content: impl Into<String>) -> El {
        text(content)
            .font(self.style())
            .color(self.color)
            .wrap()
            .wrap_anywhere()
            .rounded_lines()
            .offset(0., self.baseline())
    }
    pub fn line_text(&self, content: impl Into<String>) -> El {
        let content = content.into();
        let width = rune::text::measure(&content, &[], self.style(), None).0;
        text(content)
            .font(self.style())
            .color(self.color)
            .truncate()
            .rounded_lines()
            .w(width.ceil())
            .offset(0., self.baseline())
    }
}

pub fn icon(glyph: &'static Icon) -> El {
    icon_sized(glyph, 15.)
}

pub fn icon_sized(glyph: &'static Icon, size: f32) -> El {
    rune::icon(glyph, ui(size))
        .icon_one_color()
        .color(rgba(0xebebebb8))
}

pub fn border(el: El, hex: u32) -> El {
    el.border(1., rgba(hex)).border_layout()
}

pub fn shadow_md(el: El) -> El {
    el.box_shadow(sigma_shadow(0., 4., 6., -1.))
        .box_shadow(sigma_shadow(0., 2., 4., -2.))
}

pub fn shadow_lg(el: El) -> El {
    el.box_shadow(sigma_shadow(0., 10., 15., -3.))
        .box_shadow(sigma_shadow(0., 4., 6., -4.))
}

fn sigma_shadow(x: f32, y: f32, sigma: f32, spread: f32) -> Shadow {
    Shadow {
        x,
        y,
        blur: sigma * 2.,
        spread,
        color: Color::BLACK.alpha(0.1),
        inset: false,
    }
}

pub fn pin_fill() -> El {
    el().pin(Some(0.), Some(0.), Some(0.), Some(0.))
}

type HoverFill = (rune::Live<Color>, std::rc::Rc<std::cell::Cell<bool>>);

thread_local! {
    static FILLS: std::cell::RefCell<std::collections::HashMap<String, HoverFill>> =
        std::cell::RefCell::new(std::collections::HashMap::new());
}

pub fn swap_fill(el: El, key: &str, rest: Option<Color>, hover: Color) -> El {
    let (live, on_hover) = hover_fill(key, rest, hover);
    el.live_fill(&live).on_hover_change_any(on_hover)
}

pub fn hover_fill(
    key: &str,
    rest: Option<Color>,
    hover: Color,
) -> (rune::Live<Color>, impl Fn(bool, &mut rune::Tx) + 'static) {
    let rest = rest.unwrap_or(Color::TRANSPARENT);
    let (live, hovered) = FILLS.with_borrow_mut(|fills| {
        if fills.len() > 4096 {
            fills.retain(|_, (_, hovered)| hovered.get());
        }
        fills
            .entry(key.to_owned())
            .or_insert_with(|| {
                (
                    rune::Live::new(rest),
                    std::rc::Rc::new(std::cell::Cell::new(false)),
                )
            })
            .clone()
    });
    live.set(if hovered.get() { hover } else { rest });
    let target = live.clone();
    (live, move |inside: bool, tx: &mut rune::Tx| {
        hovered.set(inside);
        target.set(if inside { hover } else { rest });
        tx.live_only();
    })
}

pub fn plain_button(label: &str) -> El {
    plain_button_ink(label, Ink::small())
}

pub fn plain_button_ink(label: &str, ink: Ink) -> El {
    let mut button = row()
        .role("button")
        .label(label.to_owned())
        .focusable(true)
        .no_focus_ring()
        .items_center()
        .gap(ui(6.))
        .px(ui(9.))
        .h(ui(28.))
        .radius(ui(6.))
        .cursor(rune::Cursor::Pointer);
    if !label.is_empty() {
        button = button.child(ink.line_text(label.to_owned()));
    }
    button
}

pub fn button(label: &str) -> El {
    plain_button(label).hover(rgba(0xffffff0d))
}

pub fn button_ink(label: &str, ink: Ink) -> El {
    plain_button_ink(label, ink).hover(rgba(0xffffff0d))
}

pub fn menu_surface() -> El {
    shadow_lg(border(
        col()
            .max_h(ui(300.))
            .scroll(rune::ScrollSpec {
                stick_bottom: false,
            })
            .padding(ui(4.))
            .radius(ui(8.))
            .clip_rounded(ui(8.))
            .fill(colors::rgb(colors::SURFACE)),
        0xebebeb20,
    ))
}

pub fn titlebar_surface() -> El {
    row()
        .items_center()
        .h(ui(crate::zoom::TITLEBAR_HEIGHT))
        .min_h(crate::zoom::NATIVE_TITLEBAR_MIN_HEIGHT)
        .pl(96.)
}

const BEAM_FRAMES: usize = 120;
const BEAM_SLOT: f32 = 1. / BEAM_FRAMES as f32;
static BEAM_STOPS: [(f32, f32); 4] = [(0., 1.), (BEAM_SLOT, 1.), (BEAM_SLOT + 1e-4, 0.), (1., 0.)];

fn beam_point(width: f32, height: f32, radius: f32, mut distance: f32) -> [f32; 2] {
    let horizontal = width - radius * 2.;
    let vertical = height - radius * 2.;
    let arc = std::f32::consts::FRAC_PI_2 * radius;
    let lengths = [
        horizontal, arc, vertical, arc, horizontal, arc, vertical, arc,
    ];
    let mut part = 0;
    while part < 7 && distance > lengths[part] {
        distance -= lengths[part];
        part += 1;
    }
    match part {
        0 => [radius + distance, 0.],
        2 => [width, radius + distance],
        4 => [width - radius - distance, height],
        6 => [0., height - radius - distance],
        _ => {
            let corner = part / 2;
            let angle = -std::f32::consts::FRAC_PI_2
                + corner as f32 * std::f32::consts::FRAC_PI_2
                + distance / radius;
            let (x, y) = [
                (width - radius, radius),
                (width - radius, height - radius),
                (radius, height - radius),
                (radius, radius),
            ][corner];
            [x + radius * angle.cos(), y + radius * angle.sin()]
        }
    }
}

fn beam_frame(width: f32, height: f32, phase: f32) -> rune::Shape {
    let radius = ui(11.).min(width / 2.).min(height / 2.);
    let perimeter = 2. * (width - radius * 2. + height - radius * 2.)
        + 4. * std::f32::consts::FRAC_PI_2 * radius;
    let mut shape = rune::Shape::new();
    for segment in 0..240 {
        let progress = segment as f32 / 240.;
        let tail = (progress - phase).rem_euclid(1.);
        let alpha = (1. - ((tail - 0.66) / 0.14).abs()).max(0.);
        if alpha == 0. {
            continue;
        }
        let from = beam_point(width, height, radius, progress * perimeter);
        let to = beam_point(
            width,
            height,
            radius,
            (segment + 1) as f32 / 240. * perimeter,
        );
        for (stroke, opacity) in [
            (36., 0.015),
            (20., 0.025),
            (10., 0.04),
            (5., 0.08),
            (2., 0.2),
            (1., 0.65),
        ] {
            shape = shape.line(
                from,
                to,
                ui(stroke),
                rune::LineCap::Butt,
                colors::hsla((progress + phase * 0.1) % 1., 0.8, 0.65, alpha * opacity),
            );
        }
    }
    shape
}

pub fn composer_beam(key: &str) -> El {
    let Some([width, height]) = rune::memo::layout_size(key) else {
        return pin_fill();
    };
    let version = (
        width.to_bits(),
        height.to_bits(),
        crate::zoom::factor().to_bits(),
    );
    rune::memo(format!("{key}/beam"), version, || {
        let mut frames = pin_fill().radius(ui(12.)).clip_rounded(ui(12.)).inert();
        for frame in 0..BEAM_FRAMES {
            let phase = frame as f32 / BEAM_FRAMES as f32;
            frames = frames.child(
                rune::canvas(beam_frame(width, height, phase))
                    .pin(Some(0.), Some(0.), Some(0.), Some(0.))
                    .cycle(rune::Cycle {
                        period: 2.5,
                        phase,
                        stops: &BEAM_STOPS,
                        still: if frame == 0 { 1. } else { 0. },
                        fps: 120.,
                    }),
            );
        }
        frames
    })
}

pub fn composer_surface(key: &str, active: bool) -> El {
    let mut surface = border(
        col()
            .key(key.to_owned())
            .radius(ui(12.))
            .pt(ui(8.))
            .pb(ui(8.)),
        0xebebeb0f,
    )
    .fill(rgba(colors::COMPOSER));
    if active {
        surface = surface.child(composer_beam(key));
    }
    surface
}

pub fn text_baseline(style: &TextStyle) -> f32 {
    let line = if style.line_height > 0. {
        style.line_height
    } else {
        style.size * 1.25
    };
    crate::baseline::correction(
        style.size,
        line,
        matches!(style.family, Family::Mono | Family::SystemMono),
    )
}
