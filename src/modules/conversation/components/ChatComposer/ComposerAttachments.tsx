import * as stylex from "@octanejs/stylex";

import { iconSize } from "../../../../design-system/styles.stylex.ts";

import { IconButton } from "../../../../shared/ui/IconButton/index.tsx";
import { IconX } from "../../../../shared/ui/Icons/index.tsx";

import { styles } from "./styles.ts";
import type { useChatComposerState } from "./useChatComposerState.tsx";

type ComposerAttachmentsProps = Pick<
	ReturnType<typeof useChatComposerState>,
	"attachedImages" | "removeAttachedImage"
>;
export function ComposerAttachments({
	attachedImages,
	removeAttachedImage,
}: ComposerAttachmentsProps) {
	return (
		<section {...stylex.props(styles.attachments)} aria-label="Attached images">
			{attachedImages.map((img) => (
				<div key={img.path} {...stylex.props(styles.attachmentTile)}>
					<img
						src={img.previewUrl}
						alt={img.name}
						title={img.name}
						{...stylex.props(styles.attachmentImage)}
					/>
					<IconButton
						type="button"
						onClick={() => removeAttachedImage(img.path)}
						variant="ghost"
						size="xs"
						className={stylex.props(styles.attachmentRemove).className}
						title="Remove image"
					>
						<IconX size={iconSize.sm} />
					</IconButton>
				</div>
			))}
		</section>
	);
}
