import * as stylex from "@octanejs/stylex";
import {
	controlSize,
	palette,
} from "../../../../design-system/styles.stylex.ts";

export const routeStyles = stylex.create({
	shell: {
		backgroundColor: palette.canvas,
		display: "flex",
		flexDirection: "column",
		height: "100vh",
		overflow: "hidden",
	},
	windowSpacer: { flexShrink: 0, height: "1.5rem" },
	content: { flex: 1, minHeight: controlSize._0 },
});
