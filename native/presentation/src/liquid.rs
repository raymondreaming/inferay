//! Liquid surface simulation. The DOM adapter only measures and paints.
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Clone, Copy, Default, Deserialize, ts_rs::TS)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}
#[derive(Clone, Deserialize, ts_rs::TS)]
#[serde(default, rename_all = "camelCase")]
pub struct EvolveOptions {
    pub mass_stiffness: f64,
    pub mass_damping: f64,
    pub size_stiffness: f64,
    pub size_damping: f64,
    pub radius_stiffness: f64,
    pub radius_damping: f64,
    pub content_blur: f64,
    pub roundness: f64,
    pub corner_duration: f64,
    pub corner_delay: f64,
    pub corner_ease: String,
    pub anticipation: f64,
    pub travel: f64,
}
impl Default for EvolveOptions {
    fn default() -> Self {
        Self {
            mass_stiffness: 320.,
            mass_damping: 17.,
            size_stiffness: 170.,
            size_damping: 11.5,
            radius_stiffness: 900.,
            radius_damping: 60.,
            content_blur: 7.,
            roundness: 1.,
            corner_duration: 460.,
            corner_delay: 0.,
            corner_ease: "cubic-bezier(0.3, 1.05, 0.4, 1)".into(),
            anticipation: 90.,
            travel: 32.,
        }
    }
}
#[derive(Clone, Copy, Deserialize, ts_rs::TS)]
#[serde(default)]
pub struct MoveOptions {
    pub stiffness: f64,
    pub damping: f64,
    pub stretch: f64,
    pub tail: f64,
}
impl Default for MoveOptions {
    fn default() -> Self {
        Self {
            stiffness: 380.,
            damping: 18.,
            stretch: 0.18,
            tail: 0.46,
        }
    }
}
#[derive(Default, Deserialize, ts_rs::TS)]
#[serde(default, rename_all = "camelCase")]
pub struct Dynamics {
    pub evolve: bool,
    #[serde(rename = "move")]
    pub moving: bool,
    pub evolve_opts: Option<EvolveOptions>,
    pub move_opts: Option<MoveOptions>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tick {
    pub frame: Frame,
    pub dt: f64,
    pub now: f64,
    pub radius: f64,
    #[serde(default)]
    pub inset: f64,
    #[serde(default)]
    pub dynamics: Dynamics,
}
#[derive(Clone, Copy, Default)]
struct Spring {
    p: f64,
    v: f64,
}
impl Spring {
    fn at(p: f64) -> Self {
        Self { p, v: 0. }
    }
    fn step(&mut self, target: f64, k: f64, c: f64, dt: f64) {
        let n = (dt * 60.).ceil().max(1.) as usize;
        let h = dt / n as f64;
        for _ in 0..n {
            self.v += (k * (target - self.p) - c * self.v) * h;
            self.p += self.v * h;
        }
    }
}
#[derive(Default)]
struct Sim {
    x: Spring,
    y: Spring,
    w: Spring,
    h: Spring,
    r: Spring,
}
#[derive(Serialize, ts_rs::TS)]
pub struct Paint {
    pub t: String,
    pub w: String,
    pub h: String,
    pub rx: String,
}
#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct LiquidFrame {
    pub paint: Paint,
    pub tail: Option<[f64; 3]>,
    pub blur: Option<String>,
    pub settled: bool,
}
#[wasm_bindgen]
#[derive(Default)]
pub struct LiquidBody {
    sim: Option<Sim>,
    previous: Option<(f64, f64)>,
    tvx: f64,
    tvy: f64,
    lead: f64,
    corner_start: f64,
    last_move: f64,
    last_size: Option<(f64, f64)>,
    morph_active: bool,
    round: f64,
    motion: f64,
    tail_x: Spring,
    tail_y: Spring,
    tail_r: f64,
}
fn pill(r: f64, w: f64, h: f64) -> f64 {
    r.min(w.min(h) / 2.).max(0.)
}
fn js_round(v: f64) -> f64 {
    (v + 0.5).floor()
}
#[wasm_bindgen]
impl LiquidBody {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    pub fn tick(&mut self, input: &str) -> Result<String, JsValue> {
        let tick: Tick =
            serde_json::from_str(input).map_err(|e| JsValue::from_str(&e.to_string()))?;
        serde_json::to_string(&self.advance(tick)).map_err(|e| JsValue::from_str(&e.to_string()))
    }
}
impl LiquidBody {
    pub fn advance(&mut self, tick: Tick) -> LiquidFrame {
        let Tick {
            frame: f,
            dt,
            now,
            radius: tr,
            inset: bi,
            dynamics: dyns,
        } = tick;
        let dt = dt.clamp(1. / 240., 0.25);
        let (tx, ty) = (f.x + f.w / 2., f.y + f.h / 2.);
        let s = self.sim.get_or_insert_with(|| Sim {
            x: Spring::at(tx),
            y: Spring::at(ty),
            w: Spring::at(f.w),
            h: Spring::at(f.h),
            r: Spring::at(tr),
        });
        let eo = dyns.evolve_opts.unwrap_or_default();
        let mo = dyns.move_opts.unwrap_or_default();
        if dyns.moving {
            s.x.step(tx, mo.stiffness, mo.damping, dt);
            s.y.step(ty, mo.stiffness, mo.damping, dt);
        } else if dyns.evolve {
            let (vx, vy) = self
                .previous
                .map(|(x, y)| ((tx - x) / dt, (ty - y) / dt))
                .unwrap_or_default();
            self.tvx = self.tvx * 0.7 + vx * 0.3;
            self.tvy = self.tvy * 0.7 + vy * 0.3;
            self.previous = Some((tx, ty));
            let (rx, ry) = (tx - s.x.p, ty - s.y.p);
            let rem = rx.hypot(ry);
            let speed = self.tvx.hypot(self.tvy);
            let (dx, dy) = if speed > 1e-3 {
                (self.tvx / speed, self.tvy / speed)
            } else if rem > 1e-3 {
                (rx / rem, ry / rem)
            } else {
                (0., 0.)
            };
            let tau = eo.anticipation.max(0.) / 1000.;
            let k = if tau > 0. { 1. - (-dt / tau).exp() } else { 1. };
            self.lead += (if rem > 0.5 { 1. } else { 0. } - self.lead) * k;
            let reach = (eo.travel.max(0.) * self.lead).min(rem);
            s.x.step(tx + dx * reach, eo.mass_stiffness, eo.mass_damping, dt);
            s.y.step(ty + dy * reach, eo.mass_stiffness, eo.mass_damping, dt);
        } else {
            s.x = Spring::at(tx);
            s.y = Spring::at(ty);
        }
        if dyns.evolve {
            s.w.step(f.w, eo.size_stiffness, eo.size_damping, dt);
            s.h.step(f.h, eo.size_stiffness, eo.size_damping, dt);
            s.r.step(tr, eo.radius_stiffness, eo.radius_damping, dt);
        } else {
            s.w = Spring::at(f.w);
            s.h = Spring::at(f.h);
            s.r = Spring::at(tr);
        }
        let speed = s.x.v.hypot(s.y.v);
        let extra = if dyns.moving && speed > 2. {
            let stretch = mo.stretch.min(speed * 0.0006);
            let a = js_round(s.y.v.atan2(s.x.v) * 100.) / 100.;
            format!(
                " rotate({a}rad) scale({:.3}, {:.3}) rotate({}rad)",
                1. + stretch,
                1. / (1. + stretch * 0.65),
                -a
            )
        } else {
            String::new()
        };
        let tail = if dyns.moving {
            if self.tail_r == 0. && self.tail_x.p.abs() < 0.001 && self.tail_y.p.abs() < 0.001 {
                self.tail_x.p = s.x.p;
                self.tail_y.p = s.y.p;
            }
            self.tail_x.step(s.x.p, 170., 22., dt);
            self.tail_y.step(s.y.p, 170., 22., dt);
            let base = (s.w.p.min(s.h.p) - bi * 2.).max(4.);
            let (lx, ly) = (self.tail_x.p - s.x.p, self.tail_y.p - s.y.p);
            let lag = lx.hypot(ly);
            let max = base * 0.8;
            if lag > max {
                self.tail_x.p = s.x.p + lx / lag * max;
                self.tail_y.p = s.y.p + ly / lag * max;
            }
            let r = (base * mo.tail).min(((speed - 20.) * 0.03).max(0.));
            self.tail_r += (r - self.tail_r) * (dt * 10.).min(1.);
            Some(if self.tail_r < 0.3 {
                [0., 0., 0.]
            } else {
                [
                    js_round(self.tail_x.p * 10.) / 10.,
                    js_round(self.tail_y.p * 10.) / 10.,
                    js_round(self.tail_r * 10.) / 10.,
                ]
            })
        } else {
            None
        };
        let mut render_r = s.r.p.max(0.);
        let mut corner_active = false;
        let mut blur = None;
        if dyns.evolve {
            let delta = self
                .last_size
                .map(|(w, h)| (f.w - w).abs() + (f.h - h).abs())
                .unwrap_or(0.);
            let total = eo.corner_delay.max(0.) + eo.corner_duration.max(1.);
            if delta > 0.5 {
                if !self.morph_active {
                    self.corner_start = now;
                    self.morph_active = true;
                }
                self.last_move = now;
            } else if self.morph_active
                && now - self.last_move > 150.
                && now - self.corner_start > total
            {
                self.morph_active = false;
            }
            self.last_size = Some((f.w, f.h));
            let target =
                if self.corner_start > 0. && eo.roundness > 0. && now - self.corner_start < total {
                    let p = ((now - self.corner_start - eo.corner_delay.max(0.))
                        / eo.corner_duration.max(1.))
                    .clamp(0., 1.);
                    let spec = if eo.corner_ease.contains("cubic-bezier(")
                        || eo.corner_ease == "ease-in-out"
                    {
                        &eo.corner_ease
                    } else {
                        "linear"
                    };
                    ((1. - ease(spec, p)) * eo.roundness).clamp(0., 1.)
                } else {
                    0.
                };
            self.round += (target - self.round).clamp(-dt * 8., dt * 8.);
            corner_active = (self.corner_start > 0. && now - self.corner_start < total + 80.)
                || (target - self.round).abs() > 0.004
                || self.round > 0.004;
            if self.round > 0.001 {
                let target = (s.w.p.min(s.h.p) / 2.).max(render_r);
                render_r = (render_r + (target - render_r) * self.round).max(tr);
            }
            let motion = ((speed + s.w.v.abs() + s.h.v.abs()) / 420.).min(1.);
            self.motion = motion.max(self.motion - dt * 1.9);
            let px = self.motion * self.motion * eo.content_blur.max(0.);
            if px > 0.3 {
                blur = Some(format!("blur({px:.1}px)"));
            }
        }
        let bw = (s.w.p - bi * 2.).max(0.);
        let bh = (s.h.p - bi * 2.).max(0.);
        let paint = Paint {
            t: format!(
                "translate({}px, {}px){extra}",
                s.x.p - s.w.p / 2. + bi,
                s.y.p - s.h.p / 2. + bi
            ),
            w: bw.to_string(),
            h: bh.to_string(),
            rx: pill(render_r - bi, bw, bh).to_string(),
        };
        let settled = (s.x.p - tx).abs() < 0.05
            && (s.y.p - ty).abs() < 0.05
            && (s.w.p - f.w).abs() < 0.05
            && (s.h.p - f.h).abs() < 0.05
            && (s.r.p - tr).abs() < 0.05
            && speed < 1.
            && s.w.v.abs() + s.h.v.abs() + s.r.v.abs() < 1.
            && self.motion < 0.01
            && self.tail_r < 0.3
            && !corner_active;
        LiquidFrame {
            paint,
            tail,
            blur,
            settled,
        }
    }
}
#[wasm_bindgen]
pub fn ease(spec: &str, t: f64) -> f64 {
    let spec = match spec {
        "ease" => "cubic-bezier(0.25, 0.1, 0.25, 1)",
        "ease-in" => "cubic-bezier(0.42, 0, 1, 1)",
        "ease-out" => "cubic-bezier(0, 0, 0.58, 1)",
        "ease-in-out" => "cubic-bezier(0.42, 0, 0.58, 1)",
        other => other,
    }
    .trim();
    let args = |name: &str| {
        spec.strip_prefix(name)?
            .strip_suffix(')')?
            .split(',')
            .map(|s| s.trim().parse::<f64>().ok())
            .collect::<Option<Vec<_>>>()
    };
    if let Some(v) = args("linear(").filter(|v| !v.is_empty()) {
        if t <= 0. {
            return v[0];
        }
        if t >= 1. {
            return v[v.len() - 1];
        }
        let f = t * (v.len() - 1) as f64;
        let i = f.floor() as usize;
        return v[i] + (v.get(i + 1).unwrap_or(&v[i]) - v[i]) * (f - i as f64);
    }
    if let Some(v) = args("cubic-bezier(").filter(|v| v.len() == 4) {
        if t <= 0. {
            return 0.;
        }
        if t >= 1. {
            return 1.;
        }
        let (mut lo, mut hi) = (0., 1.);
        for _ in 0..24 {
            let m = (lo + hi) / 2.;
            let x = 3. * m * (1. - m) * (1. - m) * v[0] + 3. * m * m * (1. - m) * v[2] + m * m * m;
            if x < t {
                lo = m;
            } else {
                hi = m;
            }
        }
        let u = (lo + hi) / 2.;
        return 3. * u * (1. - u) * (1. - u) * v[1] + 3. * u * u * (1. - u) * v[3] + u * u * u;
    }
    t.clamp(0., 1.)
}
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)] // Scalar Wasm ABI avoids allocating for every SVG path.
pub fn rounded_rect(x: f64, y: f64, w: f64, h: f64, tl: f64, tr: f64, br: f64, bl: f64) -> String {
    let (tl, tr, br, bl) = (tl.max(0.), tr.max(0.), br.max(0.), bl.max(0.));
    let f = 1_f64
        .min(w / (tl + tr).max(1e-6))
        .min(w / (bl + br).max(1e-6))
        .min(h / (tl + bl).max(1e-6))
        .min(h / (tr + br).max(1e-6));
    let (tl, tr, br, bl) = (tl * f, tr * f, br * f, bl * f);
    format!(
        "M {} {y} H {} A {tr} {tr} 0 0 1 {} {} V {} A {br} {br} 0 0 1 {} {} H {} A {bl} {bl} 0 0 1 {x} {} V {} A {tl} {tl} 0 0 1 {} {y} Z",
        x + tl,
        x + w - tr,
        x + w,
        y + tr,
        y + h - br,
        x + w - br,
        y + h,
        x + bl,
        y + h - bl,
        y + tl,
        x + tl
    )
}
