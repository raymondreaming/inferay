import { iconSize, surfaceStyles } from "@design-system/styles.stylex.ts";
import { ariaValue, openSkills } from "@shared/lib/dom.tsx";
import { IconPencil, IconPlus } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import type { useAgentChatMenus } from "../../hooks/useAgentChatMenus.tsx";
import { styles } from "./styles.ts";

export function CommandMenu(
	_props: Pick<
		ReturnType<typeof useAgentChatMenus>,
		"filteredCommands" | "slashMenu" | "selectCommand" | "setSlashMenu"
	>,
) {
	return (
		<div
			{...stylex.attrs(
				surfaceStyles.overlay,
				styles.floatingMenu,
				styles.commandMenu,
			)}
		>
			<div {...stylex.attrs(styles.commandList)}>
				{
					<For each={_props.filteredCommands} keyed={(row) => row.name}>
						{(command, idx) => (
							<div {...stylex.attrs(styles.commandRowWrap)}>
								<button
									type="button"
									onClick={() => _props.selectCommand(idx())}
									onMouseEnter={() =>
										_props.setSlashMenu((prev) =>
											prev.selectedIdx === idx()
												? prev
												: {
														...prev,
														selectedIdx: idx(),
													},
										)
									}
									{...stylex.attrs(
										styles.commandRow,
										idx() === _props.slashMenu.selectedIdx &&
											styles.commandRowActive,
									)}
								>
									<span {...stylex.attrs(styles.commandTitleLine)}>
										<span {...stylex.attrs(styles.commandName)}>
											/{command().name}
										</span>
										{command().isLocalCommand && (
											<span {...stylex.attrs(styles.commandBadge)}>Native</span>
										)}
									</span>
								</button>
								{command().isFromLibrary && command().id && (
									<button
										type="button"
										title={`Edit /${command().name}`}
										aria-label={ariaValue(`Edit /${command().name}`)}
										onClick={() => {
											_props.setSlashMenu((prev) => ({
												...prev,
												show: false,
											}));
											openSkills({
												mode: "edit",
												skillId: command().id!,
											});
										}}
										{...stylex.attrs(styles.commandEdit)}
									>
										<IconPencil size={iconSize.sm} />
									</button>
								)}
							</div>
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
