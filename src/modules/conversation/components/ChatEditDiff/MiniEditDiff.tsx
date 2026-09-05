import { useNearViewport } from "../../../../shared/hooks/useNearViewport.tsx";
import { useNativeEditDiff } from "../../hooks/useNativeEditDiff.tsx";
import { EditDiffCard } from "./EditDiffCard.tsx";
import * as inlineStyles from "./styles.ts";

export function MiniEditDiff({
	oldStr,
	newStr,
	filePath,
	isStreaming,
}: {
	oldStr: string;
	newStr: string;
	filePath: string;
	isStreaming?: boolean;
}) {
	const fileName = filePath.split("/").pop() || filePath;
	const { ref, visible } = useNearViewport();
	const { hunks, loading, error } = useNativeEditDiff(
		oldStr,
		newStr,
		isStreaming || !visible,
	);

	return (
		<div
			ref={ref}
			style={inlineStyles.getMiniEditDiffDivStyle(
				hunks.length ? undefined : 28,
			)}
		>
			<EditDiffCard
				fileName={fileName}
				filePath={filePath}
				hunks={hunks}
				error={error}
				isStreaming={isStreaming || loading || !visible}
			/>
		</div>
	);
}
