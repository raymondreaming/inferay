import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { IconButton } from "../../../../shared/ui/IconButton/index.tsx";
import { IconX } from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";
import type { useChatComposerState } from "./useChatComposerState.tsx";

type ComposerAttachmentsProps = Pick<
	ReturnType<typeof useChatComposerState>,
	"attachedImages" | "removeAttachedImage"
>;
export function ComposerAttachments(_props: ComposerAttachmentsProps) {
	return (
		<section {...stylex.attrs(styles.attachments)} aria-label="Attached images">
			{
				<For each={_props.attachedImages} keyed={(row) => row.path}>
					{(img) => (
						<div {...stylex.attrs(styles.attachmentTile)}>
							<img
								loading="lazy"
								decoding="async"
								src={img().previewUrl}
								alt={img().name}
								title={img().name}
								{...stylex.attrs(styles.attachmentImage)}
							/>
							<IconButton
								type="button"
								onClick={() => _props.removeAttachedImage(img().path)}
								variant="ghost"
								size="xs"
								class={stylex.attrs(styles.attachmentRemove).class}
								title="Remove image"
							>
								<IconX size={iconSize.sm} />
							</IconButton>
						</div>
					)}
				</For>
			}
		</section>
	);
}
