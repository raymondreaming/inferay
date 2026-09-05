import * as stylex from "@octanejs/stylex";

import { iconSize } from "../../../../design-system/styles.stylex.ts";

import { IconChevronDown } from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";
import type { useChatComposerState } from "./useChatComposerState.tsx";

type ComposerControlsProps = Pick<
	ReturnType<typeof useChatComposerState>,
	| "agentConfigControlsRef"
	| "configControls"
	| "activeConfig"
	| "selectedModelLabel"
	| "agentConfigButtonRef"
	| "setActiveConfig"
	| "workspaceControl"
>;
export function ComposerControls({
	agentConfigControlsRef,
	configControls,
	activeConfig,
	selectedModelLabel,
	agentConfigButtonRef,
	setActiveConfig,
	workspaceControl,
}: ComposerControlsProps) {
	return (
		<div {...stylex.props(styles.pickerRow)}>
			<div
				ref={agentConfigControlsRef}
				{...stylex.props(styles.configControls)}
			>
				{configControls.map((control) => (
					<button
						key={control.id}
						type="button"
						aria-label={`${control.title}: ${control.label}`}
						aria-haspopup="menu"
						aria-expanded={activeConfig === control.id}
						title={control.id === "model" ? selectedModelLabel : control.title}
						onClick={(event) => {
							agentConfigButtonRef.current = event.currentTarget;
							setActiveConfig((current) =>
								current === control.id ? null : control.id,
							);
						}}
						{...stylex.props(
							styles.providerConfigButton,
							activeConfig === control.id && styles.providerConfigChoiceActive,
						)}
					>
						{control.icon}
						<span {...stylex.props(styles.providerConfigLabel)}>
							{control.label}
						</span>
						<IconChevronDown
							size={iconSize.sm}
							{...stylex.props(
								styles.providerConfigChevron,
								activeConfig === control.id && styles.providerConfigChevronOpen,
							)}
						/>
					</button>
				))}
			</div>
			{workspaceControl && (
				<div {...stylex.props(styles.workspaceControl)}>{workspaceControl}</div>
			)}
		</div>
	);
}
