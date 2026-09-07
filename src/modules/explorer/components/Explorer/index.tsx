import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import {
	iconSize,
	surfaceStyles,
} from "../../../../design-system/styles.stylex.ts";
import { captureEvent } from "../../../../shared/lib/dom.tsx";
import { FolderTypeIcon } from "../FileTypeIcon/index.tsx";
import { Directory } from "./Directory.tsx";
import { styles } from "./styles.ts";
export function Explorer(_props: { readonly cwds: readonly string[] }) {
	return (
		<>
			{(() => {
				if (!_props.cwds.length)
					return (
						<div {...stylex.attrs(styles.empty)}>
							Open a project in a chat to browse its files.
						</div>
					);
				return (
					<div
						data-workspace-explorer="true"
						{...stylex.attrs(styles.root)}
						ref={captureEvent("wheel", (event) =>
							((event) => {
								if (event.deltaY === 0) return;
								event.preventDefault();
								event.stopPropagation();
								event.currentTarget.scrollTop += event.deltaY;
							})?.(event),
						)}
					>
						{
							<For each={_props.cwds} keyed={(row) => row}>
								{(cwd) => (
									<section {...stylex.attrs(styles.project)}>
										<header
											{...stylex.attrs(surfaceStyles.panel, styles.projectName)}
										>
											<FolderTypeIcon path={cwd()} open size={iconSize.md} />
											<span>
												{cwd().split("/").filter(Boolean).pop() || cwd()}
											</span>
										</header>
										<Directory cwd={cwd()} />
									</section>
								)}
							</For>
						}
					</div>
				);
			})()}
		</>
	);
}
