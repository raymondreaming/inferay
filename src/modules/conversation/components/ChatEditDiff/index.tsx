import type { NativeChatRender } from "@contracts";
import { useNearViewport } from "@shared/hooks/useNearViewport.tsx";
import { assignRef, domStyle } from "@shared/lib/dom.tsx";
import { createMemo } from "solid-js";
import { useNativeEditDiff } from "../../hooks/useNativeEditDiff.tsx";
import { EditDiffCard } from "./EditDiffCard.tsx";
import * as inlineStyles from "./styles.ts";

export { MiniEditDiff } from "./MiniEditDiff.tsx";

type EditMessage = {
	content: string;
	render?: Pick<NativeChatRender, "edit">;
	isStreaming?: boolean;
};
export function GroupedEditDiff(_props: {
	filePath: string;
	edits: EditMessage[];
}) {
	const _source = useNearViewport();
	const isStreaming = createMemo(() =>
		_props.edits.some((edit) => edit.isStreaming),
	);
	const parsedEdits = createMemo(() =>
		_props.edits.flatMap((edit) =>
			edit.render?.edit ? [edit.render.edit] : [],
		),
	);
	const _source2 = useNativeEditDiff(
		() => "",
		() => "",
		() => isStreaming() || !_source.visible,
		() => parsedEdits(),
	);
	const showCard = createMemo(
		() =>
			_source2.prepared.hasChanges ||
			_source2.loading ||
			_source2.error ||
			isStreaming() ||
			!_source.visible,
	);
	return (
		<div
			ref={(_element) => assignRef(_source.ref, _element)}
			style={domStyle(
				inlineStyles.getGroupedEditDiffDivStyle(
					showCard() && !_source2.prepared.hasChanges ? 28 : undefined,
				),
			)}
		>
			{showCard() && (
				<EditDiffCard
					filePath={_props.filePath}
					prepared={_source2.prepared}
					error={_source2.error}
					isStreaming={isStreaming() || _source2.loading || !_source.visible}
				/>
			)}
		</div>
	);
}
