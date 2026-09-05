import * as stylex from "@octanejs/stylex";
import { useState } from "octane";
import { postJson } from "../../../../../adapters/backend/http.ts";
import {
	iconSize,
	runtimeColor,
} from "../../../../../design-system/styles.stylex.ts";
import { DotMatrixWeave } from "../../../../../shared/ui/DotMatrixLoader/index.tsx";
import { Liquid } from "../../../../../shared/ui/gooey/index.ts";
import {
	IconGitCommit,
	IconSparkles,
} from "../../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";

export function CommitSection({
	cwd,
	commitMessage,
	onCommitMessageChange,
	onCommit,
	isCommitting,
	stagedCount,
}: {
	cwd?: string;
	commitMessage: string;
	onCommitMessageChange: (msg: string) => void;
	onCommit: () => void;
	isCommitting: boolean;
	stagedCount: number;
}) {
	const [generating, setGenerating] = useState(false);
	const message = commitMessage.replace(/\s+/g, " ");
	const generateMessage = async () => {
		if (!cwd || !stagedCount || generating) return;
		setGenerating(true);
		try {
			const data = await postJson<{ message?: string }>(
				"/api/git/generate-commit-message",
				{ cwd },
			);
			if (data.message) {
				onCommitMessageChange(data.message.replace(/\s+/g, " ").trim());
			}
		} catch {
			// ignore
		} finally {
			setGenerating(false);
		}
	};

	return (
		<div {...stylex.props(styles.commitSection)}>
			<div {...stylex.props(styles.commitForm)}>
				<Liquid
					blur={5}
					contrast={20}
					fill={runtimeColor.backgroundRaised}
					filterPadding={18}
					shadow="inset 0 1px 0 rgba(255,255,255,.08), 0 8px 24px rgba(0,0,0,.2)"
				>
					<Liquid.Item observe radius={6}>
						<div
							{...stylex.props(styles.commitEditor, styles.commitEditorLiquid)}
						>
							<div {...stylex.props(styles.summaryRow)}>
								<input
									type="text"
									value={message}
									onInput={(e) => onCommitMessageChange(e.currentTarget.value)}
									placeholder="Message"
									data-git-commit-message
									{...stylex.props(styles.summaryInput)}
									onKeyDown={(e) => {
										if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
											e.preventDefault();
											onCommit();
										}
									}}
								/>
								<button
									type="button"
									onClick={generateMessage}
									disabled={!stagedCount || generating || !cwd}
									title="Generate commit message"
									aria-label="Generate commit message"
									{...stylex.props(styles.generateMessageButton)}
								>
									{generating ? (
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
					</Liquid.Item>
				</Liquid>
				<div {...stylex.props(styles.commitButtonSurface)}>
					<button
						type="button"
						onClick={onCommit}
						disabled={!commitMessage.trim() || isCommitting}
						{...stylex.props(styles.commitMainAction)}
					>
						<IconGitCommit size={iconSize.md} />
						{isCommitting
							? "Committing…"
							: stagedCount
								? `Commit ${stagedCount} file${stagedCount !== 1 ? "s" : ""}`
								: "Commit"}
					</button>
				</div>
			</div>
		</div>
	);
}
