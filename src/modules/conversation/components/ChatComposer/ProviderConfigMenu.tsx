import * as stylex from "@octanejs/stylex";

import { iconSize } from "../../../../design-system/styles.stylex.ts";

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
export function ProviderConfigMenu({
	agentConfigMenuRef,
	activeControl,
	setActiveConfig,
	agentConfigButtonRef,
}: ProviderConfigMenuProps) {
	return (
		<div
			ref={agentConfigMenuRef}
			{...stylex.props(styles.providerConfigAnchor)}
		>
			<div
				role="menu"
				aria-label={activeControl.title}
				{...stylex.props(styles.providerConfigMenu)}
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
					if (event.key === "Tab") setActiveConfig(null);
				}}
			>
				{activeControl.options.map((option) => (
					<button
						key={option.id}
						type="button"
						role="menuitemradio"
						aria-checked={option.id === activeControl.value}
						tabIndex={-1}
						onClick={() => {
							activeControl.onChange(option.id);
							setActiveConfig(null);
							agentConfigButtonRef.current?.focus();
						}}
						{...stylex.props(
							styles.providerConfigChoice,
							option.id === activeControl.value &&
								styles.providerConfigChoiceActive,
						)}
					>
						<span {...stylex.props(styles.providerConfigLabel)}>
							{option.label}
						</span>
						{option.id === activeControl.value && (
							<IconCheck size={iconSize.sm} />
						)}
					</button>
				))}
			</div>
		</div>
	);
}
