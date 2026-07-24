import * as stylex from "@stylexjs/stylex";
import { SimulatorPaneView } from "../Agent/SimulatorPaneView.tsx";

export function SimulatorsPage() {
	return (
		<div {...stylex.props(styles.root)}>
			<SimulatorPaneView />
		</div>
	);
}

const styles = stylex.create({
	root: {
		height: "100%",
		minHeight: 0,
		overflow: "hidden",
	},
});
