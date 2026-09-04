# Design system

There are two styling files. Import the implementing file directly; no barrels,
compatibility exports, or parallel palettes.

| Change | Owner |
| --- | --- |
| Theme colors, surface formulas, scene tints, depth effects, global CSS | [styles.css](styles.css) |
| Typed tokens, shared panel/selection styles, spacing, typography, radius, motion, runtime SVG/Liquid values | [styles.stylex.ts](styles.stylex.ts) |

[Appearance settings](../app/model/appearance.ts) owns selection and persistence,
not built-in style values. It selects CSS through root data attributes. Only a
custom image palette writes inline colors, which are cleared when switching
back to a theme or built-in scene. Settings swatches use the same CSS palettes.

## Surface roles

- `color.background`: the page/sidebar.
- `color.backgroundPanel`: the message box and selected surfaces.
- `color.backgroundModal`: opaque Settings and Skills dialogs; halfway between the base and selected-panel tones.
- `color.backgroundRaised`: menus and raised controls.
- `color.backgroundSubtle`: the palette's secondary surface.

Black mixes the panel with 45% of the base (about `#181819` in solid mode).
Midnight uses its secondary surface unchanged. Solid, scene, and glass modes
resolve these roles in CSS. Change the formula there, never in a caller.
Runtime color strings reference those same CSS properties.

## Selection contract

| Variant | Used by | Inactive | Selected |
| --- | --- | --- | --- |
| `sidebar` | Chats / Explorer | Transparent; no visible border | Panel fill + subtle border |
| `repository` | Repository tabs | Transparent; no border | Panel fill; no border or underline |
| `view` | Path / Tree | Transparent; no border | Panel fill; no border or underline |
| `list` | Chat entries | Transparent; panel + border on hover | Panel fill + subtle border |

Inactive tabs only brighten text on hover. The surrounding bar stays unfilled.
Bordered variants reserve border space to avoid movement during selection.

```tsx
import { selectionAppearance } from "../../../design-system/styles.stylex.ts";

<button
  aria-pressed={selected}
  {...stylex.props(styles.layout, ...selectionAppearance("sidebar", selected))}
/>
```

Callers own layout and behavior. Recipes own colors, borders, shadows, and
interaction states; do not override those locally. Message boxes and Explorer
headers use `surfaceStyles.panel`. Explorer rows use the row recipes.

Run `bun test tests/app-appearance.test.ts` and `bun run build:renderer`.
The tests load the production stylesheet and cover initial colors, theme
switching, previews, background modes, and clearing custom colors. Check both
themes and affected selection states in the browser after visual changes.

The StyleX build hook in `vite.config.ts` fingerprints source files before Vite
names the CSS asset. Keep this hook: StyleX inserts its final rules after asset
hashing, and the native server caches asset URLs as immutable. The regression
test `tests/stylex-asset-cache.test.ts` checks that style-only edits change the
stylesheet URL and unchanged sources keep it stable.
