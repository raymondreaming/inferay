import { Loading } from "solid-js";
import { ErrorBoundary } from "../../../../shared/ui/ErrorBoundary/index.tsx";
import { SettingsSection } from "../../../../shared/ui/SettingsSurface/index.tsx";
import { InstructionsEditor } from "./InstructionsEditor.tsx";
export function GlobalAgentInstructionsSection() {
	return (
		<SettingsSection
			id="agent-instructions"
			title="Global agent instructions"
			description="Your default AGENTS.md. Every new chat inherits these instructions."
		>
			<ErrorBoundary label="Agent instructions" contained>
				<Loading fallback={<p role="status">Loading agent instructions…</p>}>
					<InstructionsEditor />
				</Loading>
			</ErrorBoundary>
		</SettingsSection>
	);
}
