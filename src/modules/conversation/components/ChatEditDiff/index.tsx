import { useMemo } from "octane";
import { useNearViewport } from "../../../../shared/hooks/useNearViewport.tsx";
import { useNativeEditDiff } from "../../hooks/useNativeEditDiff.tsx";
import { getEditToolPayload } from "../../model/agent-chat-shared.ts";
import { EditDiffCard } from "./EditDiffCard.tsx";
import * as inlineStyles from "./styles.ts";

type EditMessage = {
	content: string;
	render?: { toolInput?: Record<string, unknown> | null };
	isStreaming?: boolean;
};

export function GroupedEditDiff({
	filePath,
	edits,
}: {
	filePath: string;
	edits: EditMessage[];
}) {
	const fileName = filePath.split("/").pop() || filePath;
	const { ref, visible } = useNearViewport();
	const isStreaming = edits.some((edit) => edit.isStreaming);
	const parsedEdits = useMemo(() => {
		const parsedEdits: { old_string: string; new_string: string }[] = [];

		for (const edit of edits) {
			if (!edit.content) continue;
			const parsed = getEditToolPayload(edit.render?.toolInput);
			if (parsed) {
				parsedEdits.push({
					old_string: parsed.oldString,
					new_string: parsed.newString,
				});
			}
		}

		return parsedEdits;
	}, [edits]);
	const { hunks, loading, error } = useNativeEditDiff(
		"",
		"",
		isStreaming || !visible,
		parsedEdits,
	);

	const showCard =
		hunks.length > 0 || loading || error || isStreaming || !visible;
	return (
		<div
			ref={ref}
			style={inlineStyles.getGroupedEditDiffDivStyle(
				showCard && !hunks.length ? 28 : undefined,
			)}
		>
			{showCard && (
				<EditDiffCard
					fileName={fileName}
					filePath={filePath}
					hunks={hunks}
					error={error}
					isStreaming={isStreaming || loading || !visible}
				/>
			)}
		</div>
	);
}

export { MiniEditDiff } from "./MiniEditDiff.tsx";
