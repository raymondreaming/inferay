import * as stylex from "@stylexjs/stylex";
import { MemoryGraph } from "../MemoryGraph/index.tsx";
import { styles } from "./styles.ts";

export function MemoryPanel(props: { projectId: string }) {
	return (
		<section aria-label="Project memory" {...stylex.attrs(styles.panel)}>
			<MemoryGraph projectId={props.projectId} />
		</section>
	);
}
