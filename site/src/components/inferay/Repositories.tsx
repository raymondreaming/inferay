import { useState } from "react";
import { Icons } from "./Icons";

type Repository = {
	id: string;
	name: string;
	path: string;
	branch: string;
	lastCommit: string;
	status: "clean" | "changes" | "behind";
	changes?: number;
};

const repositories: Repository[] = [
	{
		id: "1",
		name: "inferay",
		path: "~/projects/inferay",
		branch: "main",
		lastCommit: "2h ago",
		status: "clean",
	},
	{
		id: "2",
		name: "terminal-gui",
		path: "~/projects/terminal-gui",
		branch: "feature/workflows",
		lastCommit: "5m ago",
		status: "changes",
		changes: 3,
	},
	{
		id: "3",
		name: "api-server",
		path: "~/projects/api-server",
		branch: "main",
		lastCommit: "1d ago",
		status: "behind",
	},
	{
		id: "4",
		name: "docs",
		path: "~/projects/docs",
		branch: "main",
		lastCommit: "3d ago",
		status: "clean",
	},
];

function RepoCard({
	repo,
	isSelected,
	onSelect,
}: {
	repo: Repository;
	isSelected: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onSelect}
			className={`w-full text-left p-3 rounded-lg border transition-colors ${
				isSelected
					? "border-inferay-border bg-inferay-surface-2"
					: "border-inferay-border/50 hover:bg-inferay-surface/50 hover:border-inferay-border"
			}`}
		>
			<div className="flex items-start gap-3">
				<div className="w-8 h-8 rounded-md bg-inferay-surface border border-inferay-border flex items-center justify-center shrink-0">
					<Icons.Folder className="text-inferay-text-2" />
				</div>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<span className="text-[11px] font-medium text-inferay-text truncate">
							{repo.name}
						</span>
						{repo.status === "changes" && (
							<span className="flex items-center gap-1 text-[8px] text-inferay-text-3">
								<div className="w-1.5 h-1.5 rounded-full bg-inferay-accent" />
								{repo.changes} changes
							</span>
						)}
						{repo.status === "behind" && (
							<span className="flex items-center gap-1 text-[8px] text-inferay-text-3">
								<Icons.ArrowDown className="w-2 h-2" />
								Behind
							</span>
						)}
						{repo.status === "clean" && (
							<span className="flex items-center gap-1 text-[8px] text-inferay-text-3">
								<div className="w-1.5 h-1.5 rounded-full bg-inferay-text-3" />
								Clean
							</span>
						)}
					</div>
					<p className="text-[9px] text-inferay-text-3 truncate mt-0.5">
						{repo.path}
					</p>
					<div className="flex items-center gap-3 mt-1.5">
						<div className="flex items-center gap-1 text-inferay-text-3">
							<Icons.Branch />
							<span className="text-[8px] font-mono">{repo.branch}</span>
						</div>
						<span className="text-[8px] text-inferay-text-3">
							{repo.lastCommit}
						</span>
					</div>
				</div>
			</div>
		</button>
	);
}

function RepoDetail({ repo }: { repo: Repository }) {
	return (
		<div className="flex h-full flex-col bg-inferay-bg">
			{/* Header */}
			<div className="flex items-center gap-2 border-b border-inferay-border px-4 h-10">
				<Icons.Folder className="text-inferay-text-3" />
				<span className="text-[11px] font-medium text-inferay-text">
					{repo.name}
				</span>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto p-4 space-y-4">
				{/* Status */}
				<div className="p-3 rounded-lg bg-inferay-surface/30 border border-inferay-border">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<Icons.Branch className="text-inferay-text-3" />
							<span className="text-[10px] font-mono text-inferay-text">
								{repo.branch}
							</span>
						</div>
						{repo.status === "clean" && (
							<span className="text-[9px] text-inferay-text-2">Up to date</span>
						)}
						{repo.status === "changes" && (
							<span className="text-[9px] text-inferay-accent">
								{repo.changes} uncommitted changes
							</span>
						)}
						{repo.status === "behind" && (
							<span className="text-[9px] text-inferay-text-3">
								Behind remote
							</span>
						)}
					</div>
				</div>

				{/* Quick actions */}
				<div>
					<span className="text-[8px] font-medium uppercase tracking-wide text-inferay-text-3">
						Quick Actions
					</span>
					<div className="mt-2 space-y-1">
						<button
							type="button"
							className="w-full flex items-center gap-2 px-3 py-2 rounded-md border border-inferay-border text-[9px] text-inferay-text-2 hover:bg-inferay-surface transition-colors"
						>
							<Icons.Terminal className="text-inferay-text-3" />
							Open in Terminal
						</button>
						<button
							type="button"
							className="w-full flex items-center gap-2 px-3 py-2 rounded-md border border-inferay-border text-[9px] text-inferay-text-2 hover:bg-inferay-surface transition-colors"
						>
							<Icons.Code className="text-inferay-text-3" />
							Open in Editor
						</button>
						{repo.status === "changes" && (
							<button
								type="button"
								className="w-full flex items-center gap-2 px-3 py-2 rounded-md border border-inferay-border text-[9px] text-inferay-text-2 hover:bg-inferay-surface transition-colors"
							>
								<Icons.Git className="text-inferay-text-3" />
								Commit Changes
							</button>
						)}
						{repo.status === "behind" && (
							<button
								type="button"
								className="w-full flex items-center gap-2 px-3 py-2 rounded-md border border-inferay-border text-[9px] text-inferay-text-2 hover:bg-inferay-surface transition-colors"
							>
								<Icons.ArrowDown className="text-inferay-text-3" />
								Pull Latest
							</button>
						)}
					</div>
				</div>

				{/* Recent commits */}
				<div>
					<span className="text-[8px] font-medium uppercase tracking-wide text-inferay-text-3">
						Recent Commits
					</span>
					<div className="mt-2 space-y-1">
						{[
							{ hash: "f46b281", msg: "Add workflow builder", time: "2h ago" },
							{ hash: "ea1a878", msg: "Fix settings page", time: "5h ago" },
							{ hash: "d5775f2", msg: "Update site styles", time: "1d ago" },
						].map((commit) => (
							<div
								key={commit.hash}
								className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-inferay-surface/50 transition-colors"
							>
								<span className="text-[8px] font-mono text-inferay-accent">
									{commit.hash}
								</span>
								<span className="flex-1 text-[9px] text-inferay-text-2 truncate">
									{commit.msg}
								</span>
								<span className="text-[8px] text-inferay-text-3 shrink-0">
									{commit.time}
								</span>
							</div>
						))}
					</div>
				</div>

				{/* Branches */}
				<div>
					<span className="text-[8px] font-medium uppercase tracking-wide text-inferay-text-3">
						Branches
					</span>
					<div className="mt-2 space-y-1">
						{["main", "feature/workflows", "fix/styling"].map((branch) => (
							<div
								key={branch}
								className={`flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${
									branch === repo.branch
										? "bg-inferay-surface-2"
										: "hover:bg-inferay-surface/50"
								}`}
							>
								<Icons.Branch className="text-inferay-text-3" />
								<span
									className={`text-[9px] font-mono ${
										branch === repo.branch
											? "text-inferay-text"
											: "text-inferay-text-2"
									}`}
								>
									{branch}
								</span>
								{branch === repo.branch && (
									<span className="ml-auto text-[7px] text-inferay-accent">
										current
									</span>
								)}
							</div>
						))}
					</div>
				</div>
			</div>

			{/* Footer */}
			<div className="shrink-0 p-3 border-t border-inferay-border">
				<button
					type="button"
					className="w-full h-7 rounded-md border border-red-500/30 text-[9px] text-red-400 hover:bg-red-500/10 transition-colors"
				>
					Remove Repository
				</button>
			</div>
		</div>
	);
}

export function Repositories() {
	const [selectedRepo, setSelectedRepo] = useState<Repository | null>(
		repositories[0] ?? null
	);

	return (
		<div className="flex h-full w-full bg-inferay-bg">
			{/* List */}
			<div className="w-[280px] shrink-0 border-r border-inferay-border flex flex-col">
				{/* Header */}
				<div className="flex items-center justify-between px-4 h-10 border-b border-inferay-border">
					<span className="text-[11px] font-medium text-inferay-text">
						Repositories
					</span>
					<button
						type="button"
						className="p-1.5 rounded-md text-inferay-text-3 hover:bg-inferay-surface hover:text-inferay-text-2 transition-colors"
					>
						<Icons.Plus />
					</button>
				</div>

				{/* Search */}
				<div className="px-3 py-2 border-b border-inferay-border">
					<div className="flex items-center gap-2 h-7 px-2 rounded-md bg-inferay-surface border border-inferay-border">
						<Icons.Search className="text-inferay-text-3" />
						<input
							type="text"
							placeholder="Search repositories..."
							className="flex-1 bg-transparent text-[9px] text-inferay-text placeholder:text-inferay-text-3 outline-none"
						/>
					</div>
				</div>

				{/* List */}
				<div className="flex-1 overflow-y-auto p-3 space-y-2">
					{repositories.map((repo) => (
						<RepoCard
							key={repo.id}
							repo={repo}
							isSelected={selectedRepo?.id === repo.id}
							onSelect={() => setSelectedRepo(repo)}
						/>
					))}
				</div>

				{/* Add new */}
				<div className="shrink-0 p-3 border-t border-inferay-border">
					<button
						type="button"
						className="w-full flex items-center justify-center gap-1.5 h-8 rounded-md border border-dashed border-inferay-border text-[9px] text-inferay-text-3 hover:bg-inferay-surface hover:text-inferay-text-2 hover:border-inferay-text-3 transition-colors"
					>
						<Icons.Plus />
						Add Repository
					</button>
				</div>
			</div>

			{/* Detail */}
			{selectedRepo ? (
				<div className="flex-1 min-w-0">
					<RepoDetail repo={selectedRepo} />
				</div>
			) : (
				<div className="flex-1 flex items-center justify-center">
					<div className="text-center">
						<Icons.Folder className="w-8 h-8 mx-auto text-inferay-text-3 mb-2" />
						<p className="text-[10px] text-inferay-text-3">
							Select a repository to view details
						</p>
					</div>
				</div>
			)}
		</div>
	);
}
