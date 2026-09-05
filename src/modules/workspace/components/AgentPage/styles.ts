import * as stylex from "@octanejs/stylex";
import {
	color,
	controlSize,
	layer,
} from "../../../../design-system/styles.stylex.ts";

export const styles = stylex.create({
	appRoot: {
		display: "flex",
		flexDirection: "column",
		backgroundColor: color.transparent,
	},
	fullHeight: {
		height: "100%",
	},
	appFrame: {
		position: "relative",
		display: "flex",
		flex: 1,
		minHeight: controlSize._0,
		flexDirection: "column",
		overflow: "hidden",
	},
	appColumn: {
		display: "flex",
		flex: 1,
		minHeight: controlSize._0,
		flexDirection: "column",
		overflow: "hidden",
	},
	appBody: {
		display: "flex",
		flex: 1,
		minHeight: controlSize._0,
		overflow: "hidden",
	},
	mainPane: {
		position: "relative",
		display: "flex",
		flex: 1,
		minHeight: controlSize._0,
		flexDirection: "column",
		overflow: "hidden",
	},
	surfaceLayer: {
		position: "absolute",
		inset: controlSize._0,
		display: "flex",
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		flexDirection: "column",
		overflow: "hidden",
	},
	surfaceLayerVisible: {
		pointerEvents: "auto",
		visibility: "visible",
		zIndex: layer.content,
	},
	repositoryWorkbench: {
		display: "flex",
		width: "100%",
		height: "100%",
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		overflow: "hidden",
	},
	chatWorkspaceZen: {
		position: "fixed",
		zIndex: layer.appModal,
		inset: controlSize._0,
		backgroundColor: color.background,
	},
	chatDock: {
		display: "flex",
		minWidth: 300,
		minHeight: controlSize._0,
		flex: 1,
		overflow: "hidden",
	},
	chatDockZen: {
		width: 360,
		maxWidth: "28vw",
		flex: "0 0 auto",
	},
	emptyWorkspace: {
		flex: 1,
	},
});
