import { createMemo } from "solid-js";
import { useNearViewport } from "../../../../shared/hooks/useNearViewport.tsx";
import { assignRef, domStyle } from "../../../../shared/lib/dom.tsx";
import { useNativeEditDiff } from "../../hooks/useNativeEditDiff.tsx";
import type { NativeChatRender } from "../AgentChatView/useChatConnection.tsx";
import { EditDiffCard } from "./EditDiffCard.tsx";
import * as inlineStyles from "./styles.ts";

type EditMessage = {
	content: string;
	render?: Pick<NativeChatRender, "edit">;
	isStreaming?: boolean;
};
export function GroupedEditDiff(_props: {
	filePath: string;
	edits: EditMessage[];
}) {
	const fileName = createMemo(
		() => _props.filePath.split("/").pop() || _props.filePath,
	);
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
			_source2.hunks.length > 0 ||
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
					showCard() && !_source2.hunks.length ? 28 : undefined,
				),
			)}
		>
			{showCard() && (
				<EditDiffCard
					fileName={fileName()}
					filePath={_props.filePath}
					hunks={_source2.hunks}
					error={_source2.error}
					isStreaming={isStreaming() || _source2.loading || !_source.visible}
				/>
			)}
		</div>
	);
}
export { MiniEditDiff } from "./MiniEditDiff.tsx";
