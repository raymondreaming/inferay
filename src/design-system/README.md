# Design system

There are two styling files. Import the implementing file directly; no barrels,
compatibility exports, or parallel palettes.

| Change                                                                                                 | Owner                                |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| Theme colors, surface formulas, scene tints, depth effects, global CSS                                 | [styles.css](styles.css)             |
| Typed tokens, shared panel/selection styles, spacing, typography, radius, motion, runtime color values | [styles.stylex.ts](styles.stylex.ts) |

[Appearance settings](../modules/settings/hooks/useAppAppearance.tsx) owns selection and persistence,
not built-in style values. It selects CSS through root data attributes. Only a
custom image palette writes inline colors, which are cleared when switching
back to a theme or built-in scene. Settings swatches use the same CSS palettes.

## Surface roles

- `color.background`: the page/sidebar.
- `color.backgroundPanel`: message boxes, selected surfaces and shared floating surfaces.
- `color.backgroundRaised`: menus and raised controls.

Black mixes the panel with 45% of the base (about `#181819` in solid mode).
Black, Scene, and Glass modes resolve these roles in CSS. Floating surfaces blur
their backdrop only in Glass and Scene. Change the formula there, never in a caller.
Runtime color strings reference those same CSS properties.

## Selection contract

| Variant      | Used by          | Inactive                             | Selected                           |
| ------------ | ---------------- | ------------------------------------ | ---------------------------------- |
| `sidebar`    | Chats / Explorer | Transparent; no visible border       | Panel fill + subtle border         |
| `repository` | Repository tabs  | Transparent; no border               | Panel fill; no border or underline |
| `view`       | Path / Tree      | Transparent; no border               | Panel fill; no border or underline |
| `list`       | Chat entries     | Transparent; panel + border on hover | Panel fill + subtle border         |

Inactive tabs only brighten text on hover. The surrounding bar stays unfilled.
Bordered variants reserve border space to avoid movement during selection.

```tsx
import { selectionAppearance } from "../../../design-system/styles.stylex.ts";

<button
	aria-pressed={selected}
	{...stylex.attrs(styles.layout, ...selectionAppearance("sidebar", selected))}
/>;
```

Callers own layout and behavior. Recipes own colors, borders, shadows, and
interaction states; do not override those locally. Message boxes and Explorer
headers use `surfaceStyles.panel`. Explorer rows use the row recipes.

Run `bun run build:renderer`. Check all three background modes and affected selection states
in the browser after visual changes, including initial colors, previews,
background modes, and clearing custom colors.

Style-only edits must change the compiled stylesheet URL when its contents change,
since the native server caches asset URLs as immutable. Verify that unchanged
sources keep it stable. Remove unused typed tokens rather than retaining parallel
palettes; theme formulas remain in styles.css.
