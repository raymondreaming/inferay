import type { RepositoryWorkspace } from "@contracts";
import { iconSize, surfaceStyles } from "@design-system/styles.stylex.ts";
import { ariaValue, type CreateAgentChatTarget } from "@shared/lib/dom.tsx";
import { APP_REGION_NO_DRAG_CLASS } from "@shared/lib/windowChrome.ts";
import {
	IconFolder,
	IconMessageCircle,
	IconPlus,
} from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { styles } from "./styles.ts";

/** Creates chats or opens repositories while keeping menu interaction local. */
export function NewWorkspaceMenu(props: {
	activeWorkspace: RepositoryWorkspace | null;
	menuRef: { current: HTMLDivElement | null };
	open: boolean;
	onCreateChat: (target: CreateAgentChatTarget) => void;
	onToggle: () => void;
}) {
	const rootProps = stylex.attrs(styles.newMenuRoot);
	const buttonProps = stylex.attrs(styles.newChat);
	return (
		<div
			ref={(element) => (props.menuRef.current = element)}
			{...rootProps}
			class={`${APP_REGION_NO_DRAG_CLASS} ${rootProps.class ?? ""}`}
		>
			<button
				type="button"
				onClick={props.onToggle}
				aria-haspopup="menu"
				aria-expanded={ariaValue(props.open)}
				title="Create a chat or open a repository"
				{...buttonProps}
			>
				<span>New</span>
				<IconPlus size={iconSize.sm} />
			</button>
			{props.open ? (
				<div
					role="menu"
					aria-label="Create new"
					{...stylex.attrs(surfaceStyles.overlay, styles.newMenu)}
				>
					<button
						type="button"
						role="menuitem"
						onClick={() => props.onCreateChat("active-repository")}
						{...stylex.attrs(styles.newMenuItem)}
					>
						<IconMessageCircle size={iconSize.md} />
						<span {...stylex.attrs(styles.newMenuCopy)}>
							<strong {...stylex.attrs(styles.newMenuLabel)}>New chat</strong>
							<span {...stylex.attrs(styles.newMenuDescription)}>
								{props.activeWorkspace
									? `In ${props.activeWorkspace.name}`
									: "Choose a repository first"}
							</span>
						</span>
					</button>
					<button
						type="button"
						role="menuitem"
						onClick={() => props.onCreateChat("new-repository")}
						{...stylex.attrs(styles.newMenuItem)}
					>
						<IconFolder size={iconSize.md} />
						<span {...stylex.attrs(styles.newMenuCopy)}>
							<strong {...stylex.attrs(styles.newMenuLabel)}>
								Open repository
							</strong>
							<span {...stylex.attrs(styles.newMenuDescription)}>
								Choose another project folder
							</span>
						</span>
					</button>
				</div>
			) : null}
		</div>
	);
}
