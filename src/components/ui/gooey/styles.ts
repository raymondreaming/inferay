import * as stylex from "@octanejs/stylex";

/** Shared structural styles for consumers that prefer StyleX composition. */
export const styles = stylex.create({
	actionSurface: {
		display: "inline-flex",
		maxWidth: "100%",
		width: "fit-content",
	},
	actionSurfaceFull: {
		width: "100%",
	},
	panelSurface: {
		display: "flex",
		maxWidth: "100%",
		width: "100%",
	},
	segmentedRailLayer: {
		inset: 0,
		pointerEvents: "none",
		position: "absolute",
		zIndex: 0,
	},
});
