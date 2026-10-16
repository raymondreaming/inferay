import { AgentIcon } from "@agents/components/AgentIcon/index.tsx";
import type { ComposerConfigControl, WorkspaceAgentKind } from "@contracts";
import { getAgentDefinition, project } from "@shared/lib/native.tsx";
import { DropdownButton } from "@shared/ui/DropdownButton/index.tsx";
import * as stylex from "@stylexjs/stylex";
import {
	createEffect,
	createMemo,
	createSignal,
	type Element,
	For,
	Show,
} from "solid-js";
import { styles } from "./styles.ts";

export function ComposerControls(props: {
	agentKind: WorkspaceAgentKind;
	agentKindOptions: { id: WorkspaceAgentKind; label: string }[];
	model: string;
	reasoningLevel: string;
	onAgentKindChange: (kind: WorkspaceAgentKind) => void;
	onModelChange: (model: string) => void;
	onReasoningLevelChange: (level: string) => void;
	onAgentConfigOpenChange?: (open: boolean) => void;
	workspaceControl?: Element;
}) {
	const [active, setActive] = createSignal<string | null>(null);
	const controls = createMemo(() => {
		const { label, models, reasoningLevels } = getAgentDefinition(
			props.agentKind,
		);
		return project<ComposerConfigControl[]>("composerConfig", {
			definition: { label, models, reasoningLevels },
			agentKind: props.agentKind,
			agentKindOptions: props.agentKindOptions,
			model: props.model,
			reasoningLevel: props.reasoningLevel,
		});
	});
	createEffect(
		() => [active() !== null, props.onAgentConfigOpenChange] as const,
		([open, notify]) => {
			notify?.(open);
			return () => notify?.(false);
		},
	);
	return (
		<div {...stylex.attrs(styles.pickerRow)}>
			<div {...stylex.attrs(styles.configControls)}>
				<For each={controls()} keyed={(control) => control.id}>
					{(control) => (
						<DropdownButton
							variant="ghost"
							size="sm"
							menuPlacement="top"
							label={`${control().title}: ${control().label}`}
							title={control().tooltip}
							selectedLabel={control().label}
							value={control().value}
							options={control().options}
							open={active() === control().id}
							onOpenChange={(open) => setActive(open ? control().id : null)}
							onChange={(id) => {
								switch (control().id) {
									case "provider":
										props.onAgentKindChange(id as WorkspaceAgentKind);
										break;
									case "model":
										props.onModelChange(id);
										break;
									case "reasoning":
										props.onReasoningLevelChange(id);
										break;
								}
							}}
							icon={
								<Show when={control().agentKind}>
									{(kind) => <AgentIcon kind={kind()} size={10} />}
								</Show>
							}
						/>
					)}
				</For>
			</div>
			{props.workspaceControl && (
				<div {...stylex.attrs(styles.workspaceControl)}>
					{props.workspaceControl}
				</div>
			)}
		</div>
	);
}
