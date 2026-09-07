import * as stylex from "@stylexjs/stylex";
import type { SlashCommand } from "../../../../../build/presentation/contracts/SlashCommand.ts";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import type { Dispatch, StateUpdate } from "../../../../shared/lib/dom.tsx";
import { ariaValue, openSkills } from "../../../../shared/lib/dom.tsx";
import { IconPencil } from "../../../../shared/ui/Icons/index.tsx";
import type { SlashMenuState } from "../../hooks/useAgentChatMenus.tsx";
import { styles } from "./styles.ts";
export const CommandMenuRow = function CommandMenuRow(_props: {
	command: SlashCommand;
	index: number;
	selected: boolean;
	selectCommand: (idx: number) => void;
	setSlashMenu: Dispatch<StateUpdate<SlashMenuState>>;
}) {
	return (
		<div {...stylex.attrs(styles.commandRowWrap)}>
			<button
				type="button"
				onClick={() => _props.selectCommand(_props.index)}
				onMouseEnter={() =>
					_props.setSlashMenu((prev) =>
						prev.selectedIdx === _props.index
							? prev
							: {
									...prev,
									selectedIdx: _props.index,
								},
					)
				}
				{...stylex.attrs(
					styles.commandRow,
					_props.selected && styles.commandRowActive,
				)}
			>
				<span {...stylex.attrs(styles.commandTitleLine)}>
					<span {...stylex.attrs(styles.commandName)}>
						/{_props.command.name}
					</span>
					{_props.command.isLocalCommand && (
						<span {...stylex.attrs(styles.commandBadge)}>Native</span>
					)}
				</span>
			</button>
			{_props.command.isFromLibrary && _props.command.id && (
				<button
					type="button"
					title={`Edit /${_props.command.name}`}
					aria-label={ariaValue(`Edit /${_props.command.name}`)}
					onClick={() => {
						_props.setSlashMenu((prev) => ({
							...prev,
							show: false,
						}));
						openSkills({
							mode: "edit",
							skillId: _props.command.id!,
						});
					}}
					{...stylex.attrs(styles.commandEdit)}
				>
					<IconPencil size={iconSize.sm} />
				</button>
			)}
		</div>
	);
};
