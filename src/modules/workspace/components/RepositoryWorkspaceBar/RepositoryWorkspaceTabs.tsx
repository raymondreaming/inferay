import type { RepositoryWorkspace } from "@contracts";
import { iconSize, selectionAppearance } from "@design-system/styles.stylex.ts";
import { ariaValue } from "@shared/lib/dom.tsx";
import { APP_REGION_NO_DRAG_CLASS } from "@shared/lib/windowChrome.ts";
import { IconGitBranch } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, For } from "solid-js";
import { styles } from "./styles.ts";
import type { useRepositoryTabDrag } from "./useRepositoryTabDrag.ts";

/** Renders and coordinates repository tabs against the drag controller's small interface. */
export function RepositoryWorkspaceTabs(props: {
	activePath: string | null;
	hasWorkspaces: boolean;
	onActivate: (workspace: RepositoryWorkspace) => void;
	tabDrag: ReturnType<typeof useRepositoryTabDrag>;
}) {
	const tabsProps = stylex.attrs(styles.tabs);
	return (
		<div
			ref={props.tabDrag.setContainer}
			{...tabsProps}
			class={`${APP_REGION_NO_DRAG_CLASS} ${tabsProps.class ?? ""}`}
			role="tablist"
			aria-label="Repository workspaces"
		>
			{props.hasWorkspaces ? (
				<For each={props.tabDrag.ordered()} keyed={(row) => row.cwd}>
					{(workspace) => {
						const active = createMemo(
							() => workspace().cwd === props.activePath,
						);
						return (
							<button
								type="button"
								role="tab"
								aria-selected={ariaValue(active())}
								data-repository-tab={workspace().cwd}
								title={`${workspace().cwd}\nDrag to reorder · Alt+Shift+Arrow keys to move`}
								aria-keyshortcuts="Alt+Shift+ArrowLeft Alt+Shift+ArrowRight"
								onPointerDown={(event) =>
									props.tabDrag.onPointerDown(event, workspace().cwd)
								}
								onKeyDown={(event) =>
									props.tabDrag.onKeyDown(event, workspace().cwd)
								}
								onClick={(event) => {
									if (!props.tabDrag.consumeClick(event))
										props.onActivate(workspace());
								}}
								{...stylex.attrs(
									...selectionAppearance("repository", active()),
									styles.tab,
									props.tabDrag.dragging() === workspace().cwd &&
										styles.draggingTab,
									props.tabDrag.target()?.before === workspace().cwd &&
										styles.dropBefore,
									props.tabDrag.target()?.before === null &&
										props.tabDrag.ordered().at(-1)?.cwd === workspace().cwd &&
										styles.dropAfter,
								)}
							>
								<IconGitBranch size={iconSize.sm} />
								<span {...stylex.attrs(styles.tabLabel)}>
									{workspace().name}
								</span>
							</button>
						);
					}}
				</For>
			) : (
				<span {...stylex.attrs(styles.emptyLabel)}>No repository open</span>
			)}
		</div>
	);
}
