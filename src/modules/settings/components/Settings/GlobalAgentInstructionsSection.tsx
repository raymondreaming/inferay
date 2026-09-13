import * as stylex from "@stylexjs/stylex";
import { Loading } from "solid-js";
import { ErrorBoundary } from "../../../../shared/ui/ErrorBoundary/index.tsx";
import { InstructionsEditor } from "./InstructionsEditor.tsx";
import { styles } from "./styles.ts";
export function GlobalAgentInstructionsSection(_props: {
	contained?: boolean;
}) {
	return (
		<div
			id="agent-instructions"
			{...stylex.attrs(
				styles.section,
				(_props.contained === undefined ? false : _props.contained) &&
					styles.sectionContained,
			)}
		>
			<div {...stylex.attrs(styles.agentInstructionsHeading)}>
				<div>
					<h4 {...stylex.attrs(styles.sectionHeading)}>
						Global agent instructions
					</h4>
					<p {...stylex.attrs(styles.sectionDescription)}>
						Your default AGENTS.md. Every new chat inherits these instructions.
					</p>
				</div>
			</div>
			<ErrorBoundary label="Agent instructions" contained>
				<Loading fallback={<p role="status">Loading agent instructions…</p>}>
					<InstructionsEditor />
				</Loading>
			</ErrorBoundary>
		</div>
	);
}
