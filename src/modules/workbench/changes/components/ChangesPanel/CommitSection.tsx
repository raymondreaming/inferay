import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal } from "solid-js";
import {
	iconSize,
	runtimeColor,
} from "../../../../../design-system/styles.stylex.ts";
import { postJson } from "../../../../../shared/lib/native.tsx";
import { DotMatrixWeave } from "../../../../../shared/ui/DotMatrixLoader/index.tsx";
import { GooeyRoot } from "../../../../../shared/ui/gooey/Gooey/index.tsx";
import { LiquidItem } from "../../../../../shared/ui/gooey/LiquidItem/index.tsx";
import {
	IconGitCommit,
	IconSparkles,
} from "../../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";
export function CommitSection(_props: {
	cwd?: string;
	commitMessage: string;
	onCommitMessageChange: (msg: string) => void;
	onCommit: () => void;
	isCommitting: boolean;
	stagedCount: number;
}) {
	const [generating, setGenerating] = createSignal(false);
	const message = createMemo(() => _props.commitMessage.replace(/\s+/g, " "));
	const generateMessage = async () => {
		if (!_props.cwd || !_props.stagedCount || generating()) return;
		setGenerating(true);
		try {
			const data = await postJson<{
				message?: string;
			}>("/api/git/generate-commit-message", {
				cwd: _props.cwd,
			});
			if (data.message) {
				_props.onCommitMessageChange(data.message.replace(/\s+/g, " ").trim());
			}
		} catch {
			// ignore
		} finally {
			setGenerating(false);
		}
	};
	return (
		<div {...stylex.attrs(styles.commitSection)}>
			<div {...stylex.attrs(styles.commitForm)}>
				<GooeyRoot
					blur={5}
					contrast={20}
					fill={runtimeColor.backgroundRaised}
					filterPadding={18}
					shadow="inset 0 1px 0 rgba(255,255,255,.08), 0 8px 24px rgba(0,0,0,.2)"
				>
					<LiquidItem observe radius={6}>
						<div
							{...stylex.attrs(styles.commitEditor, styles.commitEditorLiquid)}
						>
							<div {...stylex.attrs(styles.summaryRow)}>
								<input
									type="text"
									value={message()}
									onInput={(e) =>
										_props.onCommitMessageChange(e.currentTarget.value)
									}
									placeholder="Message"
									data-git-commit-message
									{...stylex.attrs(styles.summaryInput)}
									onKeyDown={(e) => {
										if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
											e.preventDefault();
											_props.onCommit();
										}
									}}
								/>
								<button
									type="button"
									onClick={generateMessage}
									disabled={!_props.stagedCount || generating() || !_props.cwd}
									title="Generate commit message"
									aria-label="Generate commit message"
									{...stylex.attrs(styles.generateMessageButton)}
								>
									{generating() ? (
										<DotMatrixWeave
											size={iconSize._2md}
											dotSize={1.5}
											gap={1}
											speed={1.2}
											ariaLabel="Generating commit summary"
										/>
									) : (
										<IconSparkles size={iconSize.md} />
									)}
								</button>
							</div>
						</div>
					</LiquidItem>
				</GooeyRoot>
				<div {...stylex.attrs(styles.commitButtonSurface)}>
					<button
						type="button"
						onClick={_props.onCommit}
						disabled={!_props.commitMessage.trim() || _props.isCommitting}
						{...stylex.attrs(styles.commitMainAction)}
					>
						<IconGitCommit size={iconSize.md} />
						{_props.isCommitting
							? "Committing…"
							: _props.stagedCount
								? `Commit ${_props.stagedCount} file${_props.stagedCount !== 1 ? "s" : ""}`
								: "Commit"}
					</button>
				</div>
			</div>
		</div>
	);
}
