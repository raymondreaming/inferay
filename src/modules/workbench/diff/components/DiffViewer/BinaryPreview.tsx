import * as stylex from "@octanejs/stylex";
import type { HunkDiff } from "../../../../../../build/presentation/contracts/HunkDiff.ts";
import { diffStyles } from "./styles.ts";

export function BinaryPreview({
	diff,
	filePath,
}: {
	diff: Pick<HunkDiff, "isImage" | "imagePath">;
	filePath: string;
}) {
	return (
		<div {...stylex.props(diffStyles.imageBody)}>
			{diff.isImage && diff.imagePath ? (
				<img
					src={`/api/file?path=${encodeURIComponent(diff.imagePath)}`}
					alt={filePath}
					{...stylex.props(diffStyles.image)}
				/>
			) : (
				<span {...stylex.props(diffStyles.centerText)}>Binary file</span>
			)}
		</div>
	);
}
