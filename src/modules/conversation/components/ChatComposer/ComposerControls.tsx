import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { ariaValue, assignRef } from "../../../../shared/lib/dom.tsx";
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
export function ComposerControls(_props: ComposerControlsProps) {
	return (
		<div {...stylex.attrs(styles.pickerRow)}>
			<div
				ref={(_element) => assignRef(_props.agentConfigControlsRef, _element)}
				{...stylex.attrs(styles.configControls)}
			>
				<For each={_props.configControls} keyed={(control) => control.id}>
					{(control) => (
						<button
							type="button"
							aria-label={ariaValue(`${control().title}: ${control().label}`)}
							aria-haspopup="menu"
							aria-expanded={ariaValue(_props.activeConfig === control().id)}
							title={
								control().id === "model"
									? _props.selectedModelLabel
									: control().title
							}
							onClick={(event) => {
								_props.agentConfigButtonRef.current = event.currentTarget;
								_props.setActiveConfig((current) =>
									current === control().id ? null : control().id,
								);
							}}
							{...stylex.attrs(
								styles.providerConfigButton,
								_props.activeConfig === control().id &&
									styles.providerConfigChoiceActive,
							)}
						>
							{control().icon}
							<span {...stylex.attrs(styles.providerConfigLabel)}>
								{control().label}
							</span>
							<IconChevronDown
								size={iconSize.sm}
								{...stylex.attrs(
									styles.providerConfigChevron,
									_props.activeConfig === control().id &&
										styles.providerConfigChevronOpen,
								)}
							/>
						</button>
					)}
				</For>
			</div>
			{_props.workspaceControl && (
				<div {...stylex.attrs(styles.workspaceControl)}>
					{_props.workspaceControl}
				</div>
			)}
		</div>
	);
}
