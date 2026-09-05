import * as stylex from "@octanejs/stylex";
import {
	iconSize,
	surfaceStyles,
} from "../../../../design-system/styles.stylex.ts";
import { FolderTypeIcon } from "../FileTypeIcon/index.tsx";
import { Directory } from "./Directory.tsx";
import { styles } from "./styles.ts";

export function Explorer({ cwds }: { readonly cwds: readonly string[] }) {
	if (!cwds.length)
		return (
			<div {...stylex.props(styles.empty)}>
				Open a project in a chat to browse its files.
			</div>
		);
	return (
		<div
			data-workspace-explorer="true"
			onWheelCapture={(event) => {
				if (event.deltaY === 0) return;
				event.preventDefault();
				event.stopPropagation();
				event.currentTarget.scrollTop += event.deltaY;
			}}
			{...stylex.props(styles.root)}
		>
			{cwds.map((cwd) => (
				<section key={cwd} {...stylex.props(styles.project)}>
					<header {...stylex.props(surfaceStyles.panel, styles.projectName)}>
						<FolderTypeIcon path={cwd} open size={iconSize.md} />
						<span>{cwd.split("/").filter(Boolean).pop() || cwd}</span>
					</header>
					<Directory cwd={cwd} />
				</section>
			))}
		</div>
	);
}
