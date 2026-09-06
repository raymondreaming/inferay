import * as stylex from "@octanejs/stylex";

import { iconSize } from "../../../../design-system/styles.stylex.ts";

import { IconButton } from "../../../../shared/ui/IconButton/index.tsx";
import { IconX } from "../../../../shared/ui/Icons/index.tsx";
import { Markdown } from "../ChatRichContent/index.tsx";
import { styles } from "./styles.ts";
import type { useChatComposerState } from "./useChatComposerState.tsx";

type MarkdownPreviewDialogProps = Pick<
	ReturnType<typeof useChatComposerState>,
	"closeMdPreview" | "mdPreview" | "onMdFileClick"
>;
export function MarkdownPreviewDialog({
	closeMdPreview,
	mdPreview,
	onMdFileClick,
}: MarkdownPreviewDialogProps) {
	return (
		<div {...stylex.props(styles.modalBackdrop)}>
			<button
				type="button"
				aria-label="Close markdown preview"
				{...stylex.props(styles.modalBackdropButton)}
				onClick={closeMdPreview}
			/>
			<div {...stylex.props(styles.modal)}>
				<div {...stylex.props(styles.modalHeader)}>
					<span {...stylex.props(styles.modalTitle)}>{mdPreview.path}</span>
					<IconButton
						type="button"
						onClick={closeMdPreview}
						variant="ghost"
						size="xs"
					>
						<IconX size={iconSize.lg} />
					</IconButton>
				</div>
				<div {...stylex.props(styles.modalBody)}>
					{mdPreview.loading && (
						<div {...stylex.props(styles.modalState)}>
							<span {...stylex.props(styles.modalStateText)}>Loading…</span>
						</div>
					)}
					{mdPreview.error && (
						<div {...stylex.props(styles.modalState)}>
							<span {...stylex.props(styles.modalError)}>
								{mdPreview.error}
							</span>
						</div>
					)}
					{mdPreview.content && (
						<Markdown text={mdPreview.content} onMdFileClick={onMdFileClick} />
					)}
				</div>
			</div>
		</div>
	);
}
