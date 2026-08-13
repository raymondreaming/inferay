# Gooey

Vendored, Octane-adapted liquid control primitives for Inferay. Interactive
DOM stays crisp and owns clicks, focus, labels, disabled state, and keyboard
behavior; an SVG layer mirrors the control geometry underneath.

No `liquid-gooey` package dependency is installed. `LiquidAction` renders
with its semantic control immediately; route-level code splitting still keeps
the engine out of screens that do not use these controls. `LiquidPanel`
remains lazy because it is a larger, occasional treatment. Prefer the shared
`Button`, `IconButton`, and `DropdownButton` primitives; use the raw
`Liquid`, `LiquidAction`, `LiquidPanel`, or `LiquidSegmentedRail` only
for a custom control.

Keep the effect visual-only. Avoid it on typing, dragging, resize handles,
transport controls, and other high-frequency interactions. Reduced-motion
users receive a still surface.

See `UPSTREAM.md` and `LICENSE` for provenance.
