import type { MouseEvent } from "react";
import { useState } from "react";
import { Icons } from "./Icons";
import { activityTimeline, sessionTimeline } from "./data";
import { gitStatusColors } from "./fileIcons";

function stopPropagation(event: MouseEvent) {
	event.stopPropagation();
}

// Path-based file list for git changes
type PathFile = {
	name: string;
	path: string;
	status: "M" | "A" | "D";
};

const stagedPathFiles: PathFile[] = [
	{
		name: "UserProfile.tsx",
		path: "src/components/UserProfile.tsx",
		status: "M",
	},
	{ name: "useAuth.ts", path: "src/hooks/useAuth.ts", status: "M" },
	{ name: "RetryStrategy.ts", path: "src/lib/RetryStrategy.ts", status: "A" },
];

const unstagedPathFiles: PathFile[] = [
	{
		name: "ErrorBoundary.tsx",
		path: "src/components/ErrorBoundary.tsx",
		status: "M",
	},
	{ name: "api.ts", path: "src/lib/api.ts", status: "M" },
	{ name: "api.test.ts", path: "src/lib/api.test.ts", status: "A" },
	{ name: "types.ts", path: "src/types/types.ts", status: "M" },
];

// Tree structure for git changes
type TreeNode = {
	name: string;
	type: "folder" | "file";
	status?: "M" | "A" | "D";
	children?: TreeNode[];
	expanded?: boolean;
};

const stagedTree: TreeNode[] = [
	{
		name: "src",
		type: "folder",
		expanded: true,
		children: [
			{
				name: "components",
				type: "folder",
				expanded: true,
				children: [{ name: "UserProfile.tsx", type: "file", status: "M" }],
			},
			{
				name: "hooks",
				type: "folder",
				expanded: true,
				children: [{ name: "useAuth.ts", type: "file", status: "M" }],
			},
			{
				name: "lib",
				type: "folder",
				expanded: true,
				children: [{ name: "RetryStrategy.ts", type: "file", status: "A" }],
			},
		],
	},
];

const unstagedTree: TreeNode[] = [
	{
		name: "src",
		type: "folder",
		expanded: true,
		children: [
			{
				name: "components",
				type: "folder",
				expanded: true,
				children: [{ name: "ErrorBoundary.tsx", type: "file", status: "M" }],
			},
			{
				name: "lib",
				type: "folder",
				expanded: true,
				children: [
					{ name: "api.ts", type: "file", status: "M" },
					{ name: "api.test.ts", type: "file", status: "A" },
				],
			},
			{
				name: "types",
				type: "folder",
				expanded: true,
				children: [{ name: "types.ts", type: "file", status: "M" }],
			},
		],
	},
];

// File Status Icon - just the icon, no background
function FileStatusIcon({ status }: { status: "M" | "A" | "D" }) {
	if (status === "A") {
		return (
			<span className={gitStatusColors.added}>
				<Icons.FilePlus />
			</span>
		);
	}
	if (status === "D") {
		return (
			<span className={gitStatusColors.deleted}>
				<Icons.Close />
			</span>
		);
	}
	// M = modified
	return (
		<span className={gitStatusColors.modified}>
			<Icons.Edit />
		</span>
	);
}

// Tree Node Row
function TreeNodeRow({
	node,
	depth,
	selectedFile,
	onSelectFile,
	isStaged,
}: {
	node: TreeNode;
	depth: number;
	selectedFile: string;
	onSelectFile: (name: string) => void;
	isStaged: boolean;
}) {
	const [expanded, setExpanded] = useState(node.expanded ?? true);
	const isFolder = node.type === "folder";
	const paddingLeft = depth * 10 + 4;

	return (
		<>
			<button
				onClick={() => {
					if (isFolder) {
						setExpanded(!expanded);
					} else {
						onSelectFile(node.name);
					}
				}}
				className={`w-full flex items-center gap-1 py-0.5 rounded-sm transition-colors group/row ${
					!isFolder && selectedFile === node.name
						? "bg-inferay-surface-2 text-inferay-text"
						: "hover:bg-inferay-surface/50 text-inferay-text-2"
				}`}
				style={{ paddingLeft }}
			>
				{isFolder ? (
					<>
						<span
							className={`text-inferay-text-3 transition-transform ${expanded ? "rotate-90" : ""}`}
						>
							<Icons.Chevron />
						</span>
						<span className="text-inferay-text-3">
							{expanded ? <Icons.FolderOpen /> : <Icons.Folder />}
						</span>
						<span className="flex-1 truncate text-[9px] text-left">
							{node.name}
						</span>
					</>
				) : (
					<>
						<span className="w-[10px]" /> {/* spacer for alignment */}
						{node.status && <FileStatusIcon status={node.status} />}
						<span className="flex-1 truncate text-[9px] font-mono text-left">
							{node.name}
						</span>
						{/* Stage/Unstage button */}
						<button
							onClick={stopPropagation}
							className="opacity-0 group-hover/row:opacity-100 w-4 h-4 flex items-center justify-center text-inferay-text-3 hover:text-inferay-text transition-all"
						>
							{isStaged ? "−" : "+"}
						</button>
					</>
				)}
			</button>
			{isFolder && expanded && node.children && (
				<div>
					{node.children.map((child, i) => (
						<TreeNodeRow
							key={`${child.name}-${i}`}
							node={child}
							depth={depth + 1}
							selectedFile={selectedFile}
							onSelectFile={onSelectFile}
							isStaged={isStaged}
						/>
					))}
				</div>
			)}
		</>
	);
}

// File Group (Staged/Unstaged) with tree view
function FileGroupTree({
	title,
	tree,
	isStaged,
	selectedFile,
	onSelectFile,
	expanded,
	onToggle,
	fileCount,
}: {
	title: string;
	tree: TreeNode[];
	isStaged: boolean;
	selectedFile: string;
	onSelectFile: (name: string) => void;
	expanded: boolean;
	onToggle: () => void;
	fileCount: number;
}) {
	if (tree.length === 0) return null;

	return (
		<div className="mb-1">
			{/* Group header */}
			<button
				onClick={onToggle}
				className="w-full flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-inferay-surface/50 transition-colors group"
			>
				<span
					className={`transition-transform text-inferay-text-3 ${expanded ? "rotate-90" : ""}`}
				>
					<Icons.Chevron />
				</span>
				<span className="flex-1 text-left text-[9px] font-medium text-inferay-text-2">
					{title}
				</span>
				<span className="text-[8px] text-inferay-text-3">{fileCount}</span>
				{/* Stage/Unstage All button */}
				<button
					onClick={stopPropagation}
					className="opacity-0 group-hover:opacity-100 px-1 py-0.5 rounded text-[7px] text-inferay-text-3 hover:text-inferay-text hover:bg-inferay-surface-2 transition-all"
				>
					{isStaged ? "−" : "+"}
				</button>
			</button>

			{/* Tree view */}
			{expanded && (
				<div className="ml-1 pr-1">
					{tree.map((node, i) => (
						<TreeNodeRow
							key={`${node.name}-${i}`}
							node={node}
							depth={0}
							selectedFile={selectedFile}
							onSelectFile={onSelectFile}
							isStaged={isStaged}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function FileGroupPath({
	title,
	files,
	isStaged,
	selectedFile,
	onSelectFile,
	expanded,
	onToggle,
}: {
	title: string;
	files: PathFile[];
	isStaged: boolean;
	selectedFile: string;
	onSelectFile: (name: string) => void;
	expanded: boolean;
	onToggle: () => void;
}) {
	if (files.length === 0) return null;

	return (
		<div className="mb-1">
			{/* Group header */}
			<button
				onClick={onToggle}
				className="w-full flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-inferay-surface/50 transition-colors group"
			>
				<span
					className={`transition-transform text-inferay-text-3 ${expanded ? "rotate-90" : ""}`}
				>
					<Icons.Chevron />
				</span>
				<span className="flex-1 text-left text-[9px] font-medium text-inferay-text-2">
					{title}
				</span>
				<span className="text-[8px] text-inferay-text-3">{files.length}</span>
				{/* Stage/Unstage All button */}
				<button
					onClick={stopPropagation}
					className="opacity-0 group-hover:opacity-100 px-1 py-0.5 rounded text-[7px] text-inferay-text-3 hover:text-inferay-text hover:bg-inferay-surface-2 transition-all"
				>
					{isStaged ? "−" : "+"}
				</button>
			</button>

			{/* File list */}
			{expanded && (
				<div className="ml-2 pr-1">
					{files.map((file) => (
						<button
							key={file.path}
							onClick={() => onSelectFile(file.name)}
							className={`w-full flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm transition-colors group/file ${
								selectedFile === file.name
									? "bg-inferay-surface-2 text-inferay-text"
									: "hover:bg-inferay-surface/50 text-inferay-text-2"
							}`}
						>
							<FileStatusIcon status={file.status} />
							<div className="flex-1 min-w-0 text-left">
								<div className="truncate text-[9px] font-mono">{file.name}</div>
								<div className="truncate text-[8px] text-inferay-text-3">
									{file.path}
								</div>
							</div>
							{/* Stage/Unstage button */}
							<button
								onClick={stopPropagation}
								className="opacity-0 group-hover/file:opacity-100 w-4 h-4 flex items-center justify-center text-inferay-text-3 hover:text-inferay-text transition-all shrink-0"
							>
								{isStaged ? "−" : "+"}
							</button>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

// Unified Right Sidebar - Activity + Changes combined
export function UnifiedSidebar({
	selectedFile,
	onSelectFile,
}: {
	selectedFile: string;
	onSelectFile: (name: string) => void;
}) {
	const [activeTab, setActiveTab] = useState<"activity" | "changes">("changes");
	const [viewMode, setViewMode] = useState<"path" | "tree">("tree");
	const [stagedExpanded, setStagedExpanded] = useState(true);
	const [unstagedExpanded, setUnstagedExpanded] = useState(true);

	const stagedCount = stagedPathFiles.length;
	const unstagedCount = unstagedPathFiles.length;
	const totalChanges = stagedCount + unstagedCount;

	return (
		<div className="w-52 shrink-0 flex flex-col border-l border-inferay-border bg-inferay-bg">
			{/* Tab header */}
			<div className="flex items-center gap-0.5 p-1">
				<button
					onClick={() => setActiveTab("activity")}
					className={`flex items-center gap-0.5 h-5 px-1.5 rounded-md border text-[8px] font-medium transition-colors ${
						activeTab === "activity"
							? "border-inferay-border bg-inferay-surface-2 text-inferay-text"
							: "border-transparent text-inferay-text-3 hover:bg-inferay-surface hover:text-inferay-text-2"
					}`}
				>
					<span className="scale-75">
						<Icons.Timeline />
					</span>
					Activity
				</button>
				<button
					onClick={() => setActiveTab("changes")}
					className={`flex items-center gap-0.5 h-5 px-1.5 rounded-md border text-[8px] font-medium transition-colors ${
						activeTab === "changes"
							? "border-inferay-border bg-inferay-surface-2 text-inferay-text"
							: "border-transparent text-inferay-text-3 hover:bg-inferay-surface hover:text-inferay-text-2"
					}`}
				>
					<span className="scale-75">
						<Icons.Git />
					</span>
					Git
					<span className="px-0.5 rounded-full bg-inferay-surface text-[7px] text-inferay-text-3">
						{totalChanges}
					</span>
				</button>
				{/* Path/Tree toggle - only show when Git tab is active */}
				{activeTab === "changes" && (
					<>
						<span className="flex-1" />
						<button
							onClick={() => setViewMode("path")}
							className={`h-5 px-1.5 rounded-md border text-[8px] transition-colors ${
								viewMode === "path"
									? "border-inferay-border bg-inferay-surface-2 text-inferay-text"
									: "border-transparent text-inferay-text-3 hover:text-inferay-text-2"
							}`}
						>
							Path
						</button>
						<button
							onClick={() => setViewMode("tree")}
							className={`h-5 px-1.5 rounded-md border text-[8px] transition-colors ${
								viewMode === "tree"
									? "border-inferay-border bg-inferay-surface-2 text-inferay-text"
									: "border-transparent text-inferay-text-3 hover:text-inferay-text-2"
							}`}
						>
							Tree
						</button>
					</>
				)}
			</div>

			{/* Content */}
			{activeTab === "activity" ? (
				<div className="flex-1 overflow-auto p-1.5 space-y-1">
					{/* Session timeline - conversations */}
					<div className="mb-2">
						<div className="text-[8px] font-medium text-inferay-text-3 px-1 mb-1">
							Conversations
						</div>
						{sessionTimeline.map((item, idx) => (
							<div
								key={idx}
								className="flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-inferay-surface/50 transition-colors"
							>
								<div
									className={`w-3 h-3 rounded-full flex items-center justify-center shrink-0 ${
										item.status === "checkpoint"
											? "bg-inferay-accent/20 border border-inferay-accent"
											: "bg-inferay-surface border border-inferay-border"
									}`}
								>
									{item.status === "checkpoint" ? (
										<Icons.Zap />
									) : (
										<Icons.Check />
									)}
								</div>
								<span className="flex-1 truncate text-[8px] text-inferay-text">
									{item.summary}
								</span>
								{item.changes && (
									<span className="text-[7px] px-1 rounded-full bg-inferay-accent/10 text-inferay-accent shrink-0">
										{item.changes}
									</span>
								)}
								<span className="text-[7px] text-inferay-text-3 shrink-0">
									{item.time}
								</span>
							</div>
						))}
					</div>

					{/* Recent activity - tool actions */}
					<div>
						<div className="text-[8px] font-medium text-inferay-text-3 px-1 mb-1">
							Recent Actions
						</div>
						{activityTimeline.map((item, i) => (
							<div
								key={i}
								className="flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-inferay-surface/50 transition-colors"
							>
								<span className="text-[8px] tabular-nums text-inferay-text-3 shrink-0">
									{item.time}
								</span>
								<span className="text-inferay-text-2">
									{item.type === "edit" ? (
										<Icons.Edit />
									) : item.type === "bash" ? (
										<Icons.Bash />
									) : item.type === "search" ? (
										<Icons.Search />
									) : (
										<Icons.Eye />
									)}
								</span>
								<span className="flex-1 truncate text-[8px] text-inferay-text font-mono">
									{item.file || item.command || item.query}
								</span>
							</div>
						))}
					</div>
				</div>
			) : (
				<>
					{/* File groups */}
					<div className="flex-1 overflow-auto p-1.5">
						{viewMode === "path" ? (
							<>
								<FileGroupPath
									title="Staged"
									files={stagedPathFiles}
									isStaged={true}
									selectedFile={selectedFile}
									onSelectFile={onSelectFile}
									expanded={stagedExpanded}
									onToggle={() => setStagedExpanded(!stagedExpanded)}
								/>
								<FileGroupPath
									title="Unstaged"
									files={unstagedPathFiles}
									isStaged={false}
									selectedFile={selectedFile}
									onSelectFile={onSelectFile}
									expanded={unstagedExpanded}
									onToggle={() => setUnstagedExpanded(!unstagedExpanded)}
								/>
							</>
						) : (
							<>
								<FileGroupTree
									title="Staged"
									tree={stagedTree}
									isStaged={true}
									selectedFile={selectedFile}
									onSelectFile={onSelectFile}
									expanded={stagedExpanded}
									onToggle={() => setStagedExpanded(!stagedExpanded)}
									fileCount={stagedCount}
								/>
								<FileGroupTree
									title="Unstaged"
									tree={unstagedTree}
									isStaged={false}
									selectedFile={selectedFile}
									onSelectFile={onSelectFile}
									expanded={unstagedExpanded}
									onToggle={() => setUnstagedExpanded(!unstagedExpanded)}
									fileCount={unstagedCount}
								/>
							</>
						)}
					</div>

					{/* Commit section */}
					<div className="p-1.5 border-t border-inferay-border space-y-1.5">
						<input
							type="text"
							placeholder="Summary"
							className="w-full px-2 py-1 rounded-md bg-inferay-surface border border-inferay-border text-[9px] text-inferay-text placeholder:text-inferay-text-3 outline-none focus:border-inferay-accent/50 transition-colors"
						/>
						<textarea
							placeholder="Description (optional)"
							className="w-full h-10 px-2 py-1 rounded-md bg-inferay-surface border border-inferay-border text-[9px] text-inferay-text placeholder:text-inferay-text-3 resize-none outline-none focus:border-inferay-accent/50 transition-colors"
						/>
						<button
							disabled={stagedCount === 0}
							className="w-full flex items-center justify-center gap-1 py-1.5 rounded-md bg-inferay-surface-2 border border-inferay-border text-[9px] font-medium text-inferay-text hover:bg-inferay-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
						>
							<Icons.Check />
							Commit ({stagedCount})
						</button>
					</div>
				</>
			)}
		</div>
	);
}
