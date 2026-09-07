import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { openSkills } from "../../../../shared/lib/dom.tsx";
import { IconPlus } from "../../../../shared/ui/Icons/index.tsx";
import { CommandMenuRow } from "./CommandMenuRow.tsx";
import { styles } from "./styles.ts";
import type { useChatComposerState } from "./useChatComposerState.tsx";

type CommandMenuProps = Pick<
	ReturnType<typeof useChatComposerState>,
	"filteredCommands" | "slashMenu" | "selectCommand" | "setSlashMenu"
>;
export function CommandMenu(_props: CommandMenuProps) {
	return (
		<div {...stylex.attrs(styles.floatingMenu, styles.commandMenu)}>
			<div {...stylex.attrs(styles.commandList)}>
				{
					<For each={_props.filteredCommands} keyed={(row) => row.name}>
						{(command, idx) => (
							<CommandMenuRow
								command={command()}
								index={idx()}
								selected={idx() === _props.slashMenu.selectedIdx}
								selectCommand={_props.selectCommand}
								setSlashMenu={_props.setSlashMenu}
							/>
						)}
					</For>
				}
			</div>
			<div {...stylex.attrs(styles.commandFooter)}>
				<button
					type="button"
					onClick={() => {
						_props.setSlashMenu((prev) => ({
							...prev,
							show: false,
						}));
						openSkills({
							mode: "create",
						});
					}}
					{...stylex.attrs(styles.menuAction)}
				>
					<IconPlus size={iconSize.sm} /> New skill
				</button>
				<button
					type="button"
					onClick={() => {
						_props.setSlashMenu((prev) => ({
							...prev,
							show: false,
						}));
						openSkills();
					}}
					{...stylex.attrs(styles.menuAction)}
				>
					Manage skills
				</button>
			</div>
		</div>
	);
}
