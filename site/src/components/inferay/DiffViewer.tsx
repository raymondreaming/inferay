import { colors, diffRows, inlineDiffLines } from "./data";

// Diagonal hatch pattern for empty cells
const emptyHatchStyle = {
	backgroundColor: "rgba(128,128,128,0.03)",
	backgroundImage:
		"repeating-linear-gradient(-45deg, transparent, transparent 4px, rgba(255,255,255,0.03) 4px, rgba(255,255,255,0.03) 5px)",
};

// Diff Line
function DiffLine({
	lineNum,
	content,
	type,
}: {
	lineNum: number | null;
	content: string;
	type: string;
}) {
	const bgStyle =
		type === "added"
			? { background: colors.added }
			: type === "removed"
				? { background: colors.removed }
				: type === "empty"
					? emptyHatchStyle
					: { background: "transparent" };

	return (
		<div className="flex h-[15px]" style={bgStyle}>
			<span
				className="w-8 px-1 text-right text-inferay-text-3 select-none shrink-0"
				style={{ lineHeight: "15px", fontSize: "9px" }}
			>
				{lineNum ?? ""}
			</span>
			<span
				className="flex-1 pr-1.5 whitespace-pre font-mono overflow-hidden text-inferay-text"
				style={{ lineHeight: "15px", fontSize: "9px" }}
			>
				{type !== "empty" ? content : ""}
			</span>
		</div>
	);
}

// Static diff viewer for the marketing demo.
export function ShikiDiffViewer({ filePath: _filePath }: { filePath: string }) {
	return (
		<div className="flex-1 min-h-0 min-w-0 overflow-auto bg-black">
			{diffRows.map((row, i) => (
				<div key={i} className="flex">
					<div className="flex-1 min-w-0">
						<DiffLine
							lineNum={row.left.num}
							content={row.left.content}
							type={row.left.type}
						/>
					</div>
					<div className="w-px shrink-0 bg-inferay-border" />
					<div className="flex-1 min-w-0">
						<DiffLine
							lineNum={row.right.num}
							content={row.right.content}
							type={row.right.type}
						/>
					</div>
				</div>
			))}
		</div>
	);
}

// Inline diff block with Shiki (for chat messages)
export function InlineDiffBlock({
	lines,
	filePath: _filePath,
}: {
	lines: typeof inlineDiffLines;
	filePath: string;
}) {
	return (
		<div className="max-h-36 overflow-auto bg-black">
			{lines.map((line, idx) => (
				<div
					key={idx}
					className="flex leading-[12px]"
					style={{
						backgroundColor:
							line.type === "added"
								? "rgba(46,160,67,0.15)"
								: line.type === "removed"
									? "rgba(248,81,73,0.15)"
									: "transparent",
						borderLeft: `2px solid ${line.type === "added" ? "rgba(46,160,67,0.5)" : line.type === "removed" ? "rgba(248,81,73,0.5)" : "transparent"}`,
					}}
				>
					<span
						className="shrink-0 w-4 text-center select-none text-[8px]"
						style={{
							color:
								line.type === "added"
									? "rgba(46,160,67,0.7)"
									: line.type === "removed"
										? "rgba(248,81,73,0.7)"
										: "transparent",
						}}
					>
						{line.type === "added" ? "+" : line.type === "removed" ? "−" : " "}
					</span>
					<span className="flex-1 whitespace-pre pr-1.5 overflow-hidden text-[8px] font-mono text-inferay-text">
						{line.content}
					</span>
				</div>
			))}
		</div>
	);
}
