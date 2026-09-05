import * as stylex from "@octanejs/stylex";
import { memo, useRef } from "octane";
import { activateOnEnterOrSpacePreventDefault } from "../../../../../shared/lib/react-events.ts";
import type { DiffMinimapSegment as MinimapSegment } from "../../../../repository/model/types.ts";
import * as inlineStyles from "./styles.ts";
import { diffStyles } from "./styles.ts";

export const DiffMinimap = memo(function DiffMinimap({
	rowCount,
	segments,
	scrollTop,
	viewHeight,
	totalHeight,
	onScrollTo,
}: {
	rowCount: number;
	segments: MinimapSegment[];
	scrollTop: number;
	viewHeight: number;
	totalHeight: number;
	onScrollTo: (lineIndex: number) => void;
}) {
	const containerRef = useRef<HTMLButtonElement | null>(null);

	if (totalHeight <= 0 || rowCount === 0) {
		return (
			<button
				type="button"
				ref={containerRef}
				aria-label="Jump within diff"
				disabled
				{...stylex.props(diffStyles.minimap, diffStyles.minimapInteractive)}
			/>
		);
	}

	const thumbHeightRatio = Math.max(0, Math.min(1, viewHeight / totalHeight));
	const thumbTopRatio = Math.max(
		0,
		Math.min(scrollTop / totalHeight, 1 - thumbHeightRatio),
	);

	const handleClick = (e: MouseEvent) => {
		if (!containerRef.current || rowCount === 0) return;
		const rect = containerRef.current.getBoundingClientRect();
		if (rect.height <= 0) return;
		const y = e.clientY - rect.top;
		const lineIndex = Math.floor((y / rect.height) * rowCount);
		if (!Number.isFinite(lineIndex)) return;
		onScrollTo(Math.max(0, Math.min(rowCount - 1, lineIndex)));
	};
	const handleKeyboardJump = () => {
		if (rowCount === 0) return;
		onScrollTo(Math.floor(rowCount / 2));
	};

	return (
		<button
			type="button"
			ref={containerRef}
			aria-label="Jump within diff"
			{...stylex.props(diffStyles.minimap, diffStyles.minimapInteractive)}
			onClick={handleClick}
			onKeyDown={activateOnEnterOrSpacePreventDefault.bind(
				null,
				handleKeyboardJump,
			)}
		>
			{segments.map((seg) => (
				<div
					key={`${seg.side}:${seg.type}:${seg.startLine}:${seg.endLine}`}
					data-diff-minimap-change={`${seg.side}:${seg.type}`}
					{...stylex.props(
						diffStyles.minimapSegment,
						seg.type === "add"
							? diffStyles.minimapAdd
							: diffStyles.minimapDelete,
					)}
					style={inlineStyles.getDiffMinimapMinimapSegmentStyle(
						seg.side === "left" || seg.side === "full" ? 2 : undefined,
						seg.side === "right" || seg.side === "full" ? 2 : undefined,
						seg.side === "full" ? "auto" : undefined,
						`${(seg.startLine / rowCount) * 100}%`,
						`max(2px, ${((seg.endLine - seg.startLine) / rowCount) * 100}%)`,
					)}
				/>
			))}
			<div
				{...stylex.props(diffStyles.minimapThumb)}
				style={inlineStyles.getDiffMinimapMinimapThumbStyle(
					`${thumbTopRatio * 100}%`,
					`${thumbHeightRatio * 100}%`,
				)}
			/>
		</button>
	);
});
