import type { HunkDiff } from "@contracts";
import * as stylex from "@stylexjs/stylex";
import { diffStyles } from "./styles.ts";

function ImageSide(props: { label: string | null; src: string; alt: string }) {
	return (
		<div {...stylex.attrs(diffStyles.imageSide)}>
			{props.label !== null && (
				<span {...stylex.attrs(diffStyles.imageLabel)}>{props.label}</span>
			)}
			<img
				src={props.src}
				alt={props.alt}
				{...stylex.attrs(diffStyles.image)}
			/>
		</div>
	);
}

export function BinaryPreview(_props: {
	diff: Pick<HunkDiff, "isImage" | "oldImage" | "newImage">;
	filePath: string;
}) {
	const previous = () => (_props.diff.isImage && _props.diff.oldImage) || null;
	const current = () => (_props.diff.isImage && _props.diff.newImage) || null;
	const label = (side: string) => (previous() && current() ? side : null);
	return (
		<div {...stylex.attrs(diffStyles.imageBody)}>
			{previous() === null && current() === null ? (
				<span {...stylex.attrs(diffStyles.centerText)}>Binary file</span>
			) : (
				<>
					{previous() !== null && (
						<ImageSide
							label={label("Before")}
							src={previous()!}
							alt={`${_props.filePath} before`}
						/>
					)}
					{current() !== null && (
						<ImageSide
							label={label("After")}
							src={current()!}
							alt={`${_props.filePath} after`}
						/>
					)}
				</>
			)}
		</div>
	);
}
