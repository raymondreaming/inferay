import { iconSize, surfaceStyles } from "@design-system/styles.stylex.ts";
import { IconButton } from "@shared/ui/IconButton/index.tsx";
import { IconX } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import type { useAgentChatComposerState } from "../../hooks/useAgentChatComposerState.tsx";
import { Markdown } from "../ChatRichContent/index.tsx";
import { styles } from "./styles.ts";

export function MarkdownPreviewDialog(
	_props: Pick<
		ReturnType<typeof useAgentChatComposerState>,
		"closeMdPreview" | "mdPreview" | "handleMdFileClick"
	>,
) {
	return (
		<div {...stylex.attrs(styles.modalBackdrop)}>
			<button
				type="button"
				aria-label="Close markdown preview"
				{...stylex.attrs(styles.modalBackdropButton)}
				onClick={_props.closeMdPreview}
			/>
			<div {...stylex.attrs(surfaceStyles.overlay, styles.modal)}>
				<div {...stylex.attrs(styles.modalHeader)}>
					<span {...stylex.attrs(styles.modalTitle)}>
						{_props.mdPreview.path}
					</span>
					<IconButton
						type="button"
						onClick={_props.closeMdPreview}
						variant="ghost"
						size="xs"
					>
						<IconX size={iconSize.lg} />
					</IconButton>
				</div>
				<div {...stylex.attrs(styles.modalBody)}>
					{_props.mdPreview.loading && (
						<div {...stylex.attrs(styles.modalState)}>
							<span {...stylex.attrs(styles.modalStateText)}>Loading…</span>
						</div>
					)}
					{_props.mdPreview.error && (
						<div {...stylex.attrs(styles.modalState)}>
							<span {...stylex.attrs(styles.modalError)}>
								{_props.mdPreview.error}
							</span>
						</div>
					)}
					{_props.mdPreview.content && (
						<Markdown
							text={_props.mdPreview.content}
							onMdFileClick={_props.handleMdFileClick}
						/>
					)}
				</div>
			</div>
		</div>
	);
}
