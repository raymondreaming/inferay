import * as stylex from "@octanejs/stylex";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { IconPlus } from "../../../../shared/ui/Icons/index.tsx";
import { openSkills } from "../../../skills/model/skill-events.ts";
import { CommandMenuRow } from "./CommandMenuRow.tsx";

import { styles } from "./styles.ts";
import type { useChatComposerState } from "./useChatComposerState.tsx";

type CommandMenuProps = Pick<
	ReturnType<typeof useChatComposerState>,
	"filteredCommands" | "slashMenu" | "selectCommand" | "setSlashMenu"
>;
export function CommandMenu({
	filteredCommands,
	slashMenu,
	selectCommand,
	setSlashMenu,
}: CommandMenuProps) {
	return (
		<div {...stylex.props(styles.floatingMenu, styles.commandMenu)}>
			<div {...stylex.props(styles.commandList)}>
				{filteredCommands.map((command, idx) => (
					<CommandMenuRow
						key={command.id || command.name}
						command={command}
						index={idx}
						selected={idx === slashMenu.selectedIdx}
						selectCommand={selectCommand}
						setSlashMenu={setSlashMenu}
					/>
				))}
			</div>
			<div {...stylex.props(styles.commandFooter)}>
				<button
					type="button"
					onClick={() => {
						setSlashMenu((prev) => ({ ...prev, show: false }));
						openSkills({ mode: "create" });
					}}
					{...stylex.props(styles.menuAction)}
				>
					<IconPlus size={iconSize.sm} /> New skill
				</button>
				<button
					type="button"
					onClick={() => {
						setSlashMenu((prev) => ({ ...prev, show: false }));
						openSkills();
					}}
					{...stylex.props(styles.menuAction)}
				>
					Manage skills
				</button>
			</div>
		</div>
	);
}
