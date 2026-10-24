import { iconSize } from "@design-system/styles.stylex.ts";
import type { useGitChangeActions } from "@repository/hooks/useGitStatus.tsx";
import { generateCommitMessage } from "@repository/services/gitApi.ts";
import { Button } from "@shared/ui/Button/index.tsx";
import { DotMatrixLoader } from "@shared/ui/DotMatrixLoader/index.tsx";
import { IconButton } from "@shared/ui/IconButton/index.tsx";
import { IconGitCommit, IconSparkles } from "@shared/ui/Icons/index.tsx";
import { TextInput } from "@shared/ui/TextInput/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal } from "solid-js";
import { styles } from "./styles.ts";
export function CommitSection(_props: {
	actions: Pick<
		ReturnType<typeof useGitChangeActions>,
		"commitMessage" | "setCommitMessage" | "commit" | "isCommitting"
	>;
	cwd?: string;
	stagedCount: number;
}) {
	const [generating, setGenerating] = createSignal(false);
	const message = createMemo(() =>
		_props.actions.commitMessage.replace(/\s+/g, " "),
	);
	const generateMessage = async () => {
		if (!_props.cwd || !_props.stagedCount || generating()) return;
		setGenerating(true);
		try {
			const generated = await generateCommitMessage(_props.cwd);
			if (generated) {
				_props.actions.setCommitMessage(generated.replace(/\s+/g, " ").trim());
			}
		} catch {
			// ignore
		} finally {
			setGenerating(false);
		}
	};
	return (
		<div {...stylex.attrs(styles.commitSection)}>
			<div {...stylex.attrs(styles.commitMessageRow)}>
				<TextInput
					size="sm"
					fullWidth
					value={message()}
					onInput={(e) =>
						_props.actions.setCommitMessage(e.currentTarget.value)
					}
					placeholder="Commit message"
					aria-label="Commit message"
					data-git-commit-message
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
							e.preventDefault();
							_props.actions.commit();
						}
					}}
				/>
				<IconButton
					onClick={generateMessage}
					disabled={!_props.stagedCount || generating() || !_props.cwd}
					title="Generate commit message"
					aria-label="Generate commit message"
				>
					{generating() ? (
						<DotMatrixLoader
							variant="weave"
							size={iconSize._2md}
							dotSize={1.5}
							gap={1}
							speed={1.2}
							ariaLabel="Generating commit summary"
						/>
					) : (
						<IconSparkles size={iconSize.md} />
					)}
				</IconButton>
			</div>
			<Button
				variant="primary"
				size="sm"
				onClick={_props.actions.commit}
				disabled={
					!_props.actions.commitMessage.trim() || _props.actions.isCommitting
				}
				{...stylex.attrs(styles.commitAction)}
			>
				<IconGitCommit size={iconSize.md} />
				{_props.actions.isCommitting
					? "Committing…"
					: _props.stagedCount
						? `Commit ${_props.stagedCount} file${_props.stagedCount !== 1 ? "s" : ""}`
						: "Commit"}
			</Button>
		</div>
	);
}
