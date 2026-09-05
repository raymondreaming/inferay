import * as stylex from "@octanejs/stylex";
import { memo } from "octane";
import type React from "react";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { IconPencil } from "../../../../shared/ui/Icons/index.tsx";
import { openSkills } from "../../../skills/model/skill-library.ts";
import type { SlashMenuState } from "../../hooks/useAgentChatMenus.tsx";
import type { SlashCommand } from "../../model/agent-chat-shared.ts";
import { styles } from "./styles.ts";

export const CommandMenuRow = memo(function CommandMenuRow({
	command,
	index,
	selected,
	selectCommand,
	setSlashMenu,
}: {
	command: SlashCommand;
	index: number;
	selected: boolean;
	selectCommand: (idx: number) => void;
	setSlashMenu: React.Dispatch<React.SetStateAction<SlashMenuState>>;
}) {
	return (
		<div {...stylex.props(styles.commandRowWrap)}>
			<button
				type="button"
				onClick={() => selectCommand(index)}
				onMouseEnter={() =>
					setSlashMenu((prev) =>
						prev.selectedIdx === index ? prev : { ...prev, selectedIdx: index },
					)
				}
				{...stylex.props(
					styles.commandRow,
					selected && styles.commandRowActive,
				)}
			>
				<span {...stylex.props(styles.commandTitleLine)}>
					<span {...stylex.props(styles.commandName)}>/{command.name}</span>
					{command.isLocalCommand && (
						<span {...stylex.props(styles.commandBadge)}>Native</span>
					)}
				</span>
			</button>
			{command.isFromLibrary && command.id && (
				<button
					type="button"
					title={`Edit /${command.name}`}
					aria-label={`Edit /${command.name}`}
					onClick={() => {
						setSlashMenu((prev) => ({ ...prev, show: false }));
						openSkills({ mode: "edit", skillId: command.id! });
					}}
					{...stylex.props(styles.commandEdit)}
				>
					<IconPencil size={iconSize.sm} />
				</button>
			)}
		</div>
	);
});
