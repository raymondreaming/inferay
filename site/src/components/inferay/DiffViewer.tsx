import { colors, diffRows, inlineDiffLines } from "./data";
import { Icons } from "./Icons";

type DiffRowType = "normal" | "added" | "removed" | "empty";
type InlineLine = (typeof inlineDiffLines)[number];

const emptyHatchStyle = {
	backgroundColor: "rgba(128,128,128,0.03)",
	backgroundImage:
		"repeating-linear-gradient(-45deg, transparent, transparent 4px, rgba(255,255,255,0.03) 4px, rgba(255,255,255,0.03) 5px)",
};

function rowBackground(type: string) {
	if (type === "added") return { background: colors.added };
	if (type === "removed") return { background: colors.removed };
	if (type === "empty") return emptyHatchStyle;
	return { background: "transparent" };
}

function DiffLine({
	lineNum,
	content,
	type,
}: {
	lineNum: number | null;
	content: string;
	type: string;
}) {
	return (
		<div className="flex h-[17px]" style={rowBackground(type)}>
			<span className="w-9 shrink-0 select-none px-1.5 text-right font-mono text-[9px] leading-[17px] text-inferay-text-3">
				{lineNum ?? ""}
			</span>
			<span className="min-w-0 flex-1 overflow-hidden whitespace-pre pr-2 font-mono text-[10px] leading-[17px] text-inferay-text">
				{type !== "empty" ? content : ""}
			</span>
		</div>
	);
}

function FileHeader() {
	return (
		<div className="flex h-8 shrink-0 items-center gap-2 border-b border-inferay-border bg-inferay-bg px-2">
			<span className="text-inferay-text-3">
				<Icons.FilePlus />
			</span>
			<span className="min-w-0 flex-1 truncate font-mono text-[10px] font-medium text-inferay-text">
				src/components/chat/ChatComposer.tsx
			</span>
			<span className="font-mono text-[9px] text-green-400">+24</span>
			<span className="font-mono text-[9px] text-red-400">-7</span>
		</div>
	);
}

export function ShikiDiffViewer({ filePath: _filePath }: { filePath: string }) {
	return (
		<div className="flex min-h-0 flex-1 flex-col bg-black">
			<FileHeader />
			<div className="grid min-h-0 flex-1 grid-cols-2 overflow-auto">
				{diffRows.map((row, index) => (
					<div key={index} className="contents">
						<div className="min-w-0 border-r border-inferay-border">
							<DiffLine
								lineNum={row.left.num}
								content={row.left.content}
								type={row.left.type}
							/>
						</div>
						<div className="min-w-0">
							<DiffLine
								lineNum={row.right.num}
								content={row.right.content}
								type={row.right.type}
							/>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function inlineLineClass(type: InlineLine["type"]) {
	if (type === "added") return "bg-[rgba(46,160,67,0.08)]";
	if (type === "removed") return "bg-[rgba(248,81,73,0.08)]";
	return "";
}

function inlineBorder(type: InlineLine["type"]) {
	if (type === "added") return "rgba(46,160,67,0.32)";
	if (type === "removed") return "rgba(248,81,73,0.32)";
	return "transparent";
}

export function InlineDiffBlock({
	lines,
	filePath,
}: {
	lines: typeof inlineDiffLines;
	filePath: string;
}) {
	let oldLine = 42;
	let newLine = 42;

	return (
		<div className="max-h-40 overflow-auto bg-black font-mono">
			<div className="flex items-center gap-1.5 border-b border-inferay-border bg-inferay-surface px-2 py-1 text-[8px] text-inferay-text-3">
				<span>@@ -42,7 +42,11 @@</span>
				<span className="min-w-0 flex-1 truncate text-right">{filePath}</span>
			</div>
			{lines.map((line, index) => {
				const type = line.type as DiffRowType;
				const previousLine = type === "added" ? "" : oldLine++;
				const nextLine = type === "removed" ? "" : newLine++;
				return (
					<div
						key={index}
						className={`flex min-w-full leading-[16px] ${inlineLineClass(line.type)}`}
						style={{ borderLeft: `2px solid ${inlineBorder(line.type)}` }}
					>
						<span
							className={`w-4 shrink-0 select-none text-center text-[9px] ${
								line.type === "added"
									? "text-green-400"
									: line.type === "removed"
										? "text-red-400"
										: "text-inferay-text-3"
							}`}
						>
							{line.type === "added"
								? "+"
								: line.type === "removed"
									? "-"
									: " "}
						</span>
						<span className="grid w-12 shrink-0 grid-cols-2 select-none text-right text-[8px] text-inferay-text-3">
							<span className="pr-1">{previousLine}</span>
							<span className="pr-2">{nextLine}</span>
						</span>
						<span className="min-w-0 flex-1 overflow-hidden whitespace-pre pr-2 text-[9px] text-inferay-text">
							{line.content || " "}
						</span>
					</div>
				);
			})}
		</div>
	);
}
