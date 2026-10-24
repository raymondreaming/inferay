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

- `color.shellSurface`: the window chrome behind project tabs and the chat sidebar.
- `color.backgroundCanvas`: the darker, rounded workspace inside that shell.
- `color.background`: page content within the workspace.
- `color.backgroundPanel`: message boxes, selected surfaces and shared floating surfaces.
- `color.backgroundRaised`: menus and raised controls.

Dark uses neutral charcoal surfaces: a `#303030` shell, `#202020` workspace,
and lighter controls. Glass uses the existing native window backdrop with a 5%
white shell wash, near-black raised surfaces, and a darker translucent workspace. Sidebar and title bar stay
transparent so the wash is applied once. Project tabs stay at the top; chats stay
in the left sidebar.

Floating surfaces use a 24px backdrop blur in Glass mode. Scene softens the image
behind the workspace; Dark and native Glass do not apply a CSS blur across the
workspace. Change surface formulas in CSS, never in a caller. Runtime color
strings reference those same CSS properties. Selections use a shared light wash
and quiet borders across all three modes.

## Selection contract

| Variant      | Used by          | Inactive                                   | Selected                                      |
| ------------ | ---------------- | ------------------------------------------ | --------------------------------------------- |
| `sidebar`    | Chats / Explorer | Transparent; no visible border             | Shared selection wash + subtle border         |
| `repository` | Repository tabs  | Transparent; no border                     | Rounded light wash; no underline              |
| `view`       | Path / Tree      | Transparent; no border                     | Shared selection wash; no border or underline |
| `list`       | Chat entries     | Transparent; subtle fill + border on hover | Shared selection wash + subtle border         |

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

Dialog forms use 16px padding, 12px gaps, compact labels and trailing action rows. Optional instructions and archive controls can use disclosure sections to keep common actions visible. Modal backgrounds use the app canvas surface and the shared floating-surface blur, keeping the selected background treatment. Input focus uses the neutral gray `color.focusRing`, independent of accent themes. Keep a visible focus border for keyboard navigation.

Settings uses a full app page: a 38px breadcrumb/search header, a 220px grouped navigation rail, and a centered content column on the app canvas surface. Shared `SettingsSurface` sections own compact bordered cards and divided rows. Back/forward navigation stays inside Settings; Back to workspace and Escape restore the existing workspace and focus. Settings never mounts a modal or backdrop. Skills uses the same page shell with a compact library/editor card; chat and command-palette skill actions navigate there. Unsaved skill edits guard navigation and closing.
