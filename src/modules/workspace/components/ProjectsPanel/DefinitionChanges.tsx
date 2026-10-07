import type { PluginReviewFile } from "@contracts";
import { Button } from "@shared/ui/Button/index.tsx";
import { CardInstructions } from "@shared/ui/ChatActionCard/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, For } from "solid-js";
import { styles } from "./styles.ts";

export function DefinitionChanges(props: {
	files: PluginReviewFile[];
	beforeLabel: string;
	afterLabel: string;
}) {
	const [showUnchanged, setShowUnchanged] = createSignal(false);
	const unchanged = () =>
		props.files.filter((file) => file.hash === file.previousHash).length;
	const visible = () =>
		props.files.filter(
			(file) => showUnchanged() || file.hash !== file.previousHash,
		);
	return (
		<div {...stylex.attrs(styles.list)}>
			{unchanged() > 0 && (
				<Button
					size="sm"
					variant="ghost"
					onClick={() => setShowUnchanged(!showUnchanged())}
				>
					{showUnchanged()
						? "Hide unchanged files"
						: `Show ${unchanged()} unchanged files`}
				</Button>
			)}
			{visible().length === 0 && (
				<p {...stylex.attrs(styles.muted)}>No file changes</p>
			)}
			<For each={visible()} keyed={(item) => item.path}>
				{(file) => (
					<details {...stylex.attrs(styles.changeFile)}>
						<summary {...stylex.attrs(styles.changeSummary)}>
							<span>{file().path}</span>
							<span {...stylex.attrs(styles.muted)}>
								{file().hash === file().previousHash
									? "Unchanged"
									: !file().hash
										? "Removed"
										: !file().previousHash
											? "Added"
											: "Changed"}
							</span>
						</summary>
						<div {...stylex.attrs(styles.changeColumns)}>
							{file().previousHash && file().hash !== file().previousHash && (
								<div {...stylex.attrs(styles.changeVersion)}>
									<strong {...stylex.attrs(styles.muted)}>
										{props.beforeLabel}
									</strong>
									<CardInstructions
										label="View full file"
										text={
											file().previousContent ??
											"Binary or large file · Content preview unavailable"
										}
									/>
								</div>
							)}
							{file().hash && (
								<div {...stylex.attrs(styles.changeVersion)}>
									<strong {...stylex.attrs(styles.muted)}>
										{props.afterLabel}
									</strong>
									<CardInstructions
										label="View full file"
										text={
											file().content ??
											"Binary or large file · Content preview unavailable"
										}
									/>
								</div>
							)}
						</div>
					</details>
				)}
			</For>
		</div>
	);
}
