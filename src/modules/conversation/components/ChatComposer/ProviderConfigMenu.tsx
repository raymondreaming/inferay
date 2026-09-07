import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { ariaValue, assignRef } from "../../../../shared/lib/dom.tsx";
import { IconCheck } from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";
import type { useChatComposerState } from "./useChatComposerState.tsx";

type ProviderConfigMenuProps = Pick<
	ReturnType<typeof useChatComposerState>,
	"agentConfigMenuRef" | "setActiveConfig" | "agentConfigButtonRef"
> & {
	activeControl: NonNullable<
		ReturnType<typeof useChatComposerState>["activeControl"]
	>;
};
export function ProviderConfigMenu(_props: ProviderConfigMenuProps) {
	return (
		<div
			ref={(_element) => assignRef(_props.agentConfigMenuRef, _element)}
			{...stylex.attrs(styles.providerConfigAnchor)}
		>
			<div
				role="menu"
				aria-label={ariaValue(_props.activeControl.title)}
				{...stylex.attrs(styles.providerConfigMenu)}
				onKeyDown={(event) => {
					const buttons = Array.from(
						event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
					);
					const index = buttons.indexOf(
						document.activeElement as HTMLButtonElement,
					);
					const next =
						event.key === "Home"
							? 0
							: event.key === "End"
								? buttons.length - 1
								: event.key === "ArrowDown"
									? (index + 1) % buttons.length
									: event.key === "ArrowUp"
										? (index - 1 + buttons.length) % buttons.length
										: -1;
					if (next >= 0) {
						event.preventDefault();
						buttons[next]?.focus();
					}
					if (event.key === "Tab") _props.setActiveConfig(null);
				}}
			>
				{
					<For each={_props.activeControl.options} keyed={(row) => row.id}>
						{(option) => (
							<button
								type="button"
								role="menuitemradio"
								aria-checked={ariaValue(
									option().id === _props.activeControl.value,
								)}
								tabindex={-1}
								onClick={() => {
									_props.activeControl.onChange(option().id);
									_props.setActiveConfig(null);
									_props.agentConfigButtonRef.current?.focus();
								}}
								{...stylex.attrs(
									styles.providerConfigChoice,
									option().id === _props.activeControl.value &&
										styles.providerConfigChoiceActive,
								)}
							>
								<span {...stylex.attrs(styles.providerConfigLabel)}>
									{option().label}
								</span>
								{option().id === _props.activeControl.value && (
									<IconCheck size={iconSize.sm} />
								)}
							</button>
						)}
					</For>
				}
			</div>
		</div>
	);
}
