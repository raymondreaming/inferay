import type { ReactElement, ReactNode } from "react";
import { useState } from "react";
import { ChatGridView, ChatPanel } from "./inferay/ChatPanel";
import { ShikiDiffViewer } from "./inferay/DiffViewer";
import { GraphView } from "./inferay/GraphView";
import { Icons } from "./inferay/Icons";

type View =
	| "chat"
	| "editor"
	| "changes"
	| "graph"
	| "prompts"
	| "goals"
	| "automations"
	| "files"
	| "simulators"
	| "profile";

const terminalViews: Array<{
	id: Extract<View, "chat" | "editor" | "changes" | "graph">;
	label: string;
	icon: ReactElement;
}> = [
	{ id: "chat", label: "Chat", icon: <Icons.Chat /> },
	{ id: "editor", label: "Editor", icon: <Icons.Code /> },
	{ id: "changes", label: "Changes", icon: <Icons.Git /> },
	{ id: "graph", label: "Graph", icon: <Icons.Graph /> },
];

const sidebarRoutes: Array<{
	id: Extract<
		View,
		"prompts" | "goals" | "automations" | "files" | "simulators"
	>;
	label: string;
	icon: ReactElement;
}> = [
	{ id: "prompts", label: "Prompts", icon: <Icons.File /> },
	{ id: "goals", label: "Goals", icon: <Icons.Check /> },
	{ id: "automations", label: "Automations", icon: <Icons.Workflow /> },
	{ id: "files", label: "Files", icon: <Icons.FilePlus /> },
	{ id: "simulators", label: "Simulators", icon: <Icons.Image /> },
];

const workspaces = [
	{
		id: "main",
		name: "Main",
		items: [
			{ title: "Align site demo", folder: "inferay", type: "codex" },
			{ title: "Files workflow", folder: "inferay", type: "claude" },
		],
	},
	{
		id: "release",
		name: "Release",
		items: [{ title: "Vercel build", folder: "site", type: "codex" }],
	},
];

const fileRows = [
	{
		name: "Screenshot_2026-05-26_at_8.25.47_AM.png",
		added: "May 26",
		size: "1.8 MB",
		selected: true,
		color: "from-sky-300/60 to-zinc-900",
	},
	{
		name: "site-hero-container.png",
		added: "May 26",
		size: "962 KB",
		selected: true,
		color: "from-amber-300/60 to-zinc-900",
	},
	{
		name: "fullscreen-titlebar-check.png",
		added: "May 25",
		size: "712 KB",
		selected: false,
		color: "from-emerald-300/50 to-zinc-900",
	},
	{
		name: "files-page-reference.png",
		added: "May 25",
		size: "540 KB",
		selected: false,
		color: "from-violet-300/50 to-zinc-900",
	},
];

const changes = [
	{ name: "Inferay.tsx", path: "site/src/components", status: "M" },
	{ name: "ChatPanel.tsx", path: "site/src/components/inferay", status: "M" },
	{ name: "DiffViewer.tsx", path: "site/src/components/inferay", status: "M" },
	{ name: "package-lock.json", path: "site", status: "M" },
];

function AppButton({
	active,
	children,
	onClick,
	title,
}: {
	active?: boolean;
	children: ReactNode;
	onClick?: () => void;
	title?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			className={`flex h-7 items-center justify-center rounded-md border px-2 text-[10px] font-medium transition-colors ${
				active
					? "border-inferay-border bg-inferay-surface-2 text-inferay-text"
					: "border-transparent text-inferay-text-3 hover:bg-inferay-surface hover:text-inferay-text-2"
			}`}
		>
			{children}
		</button>
	);
}

function Sidebar({
	view,
	setView,
}: {
	view: View;
	setView: (view: View) => void;
}) {
	return (
		<aside className="flex w-48 shrink-0 flex-col border-r border-inferay-border bg-inferay-bg">
			<div className="flex h-11 items-center gap-2 border-b border-inferay-border px-3">
				<img
					src="/app-icon.png"
					alt="inferay"
					className="h-6 w-6 rounded-md object-cover"
				/>
				<div className="min-w-0">
					<div className="text-[11px] font-semibold text-inferay-text">
						inferay
					</div>
					<div className="text-[8px] text-inferay-text-3">
						Multi-agent terminal
					</div>
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
				<div className="mb-2 flex items-center justify-between px-1">
					<span className="text-[8px] font-semibold uppercase tracking-wide text-inferay-text-3">
						Workspaces
					</span>
					<button
						type="button"
						className="flex h-5 w-5 items-center justify-center rounded text-inferay-text-3 hover:bg-inferay-surface hover:text-inferay-text"
						title="New workspace"
					>
						<Icons.Plus />
					</button>
				</div>

				<div className="space-y-2">
					{workspaces.map((workspace) => (
						<div key={workspace.id}>
							<button
								type="button"
								className="flex w-full items-center gap-1 rounded-md px-1 py-1 text-left text-[9px] font-medium text-inferay-text-2 hover:bg-inferay-surface"
							>
								<span className="rotate-90 text-inferay-text-3">
									<Icons.Chevron />
								</span>
								{workspace.name}
							</button>
							<div className="space-y-1">
								{workspace.items.map((item, index) => (
									<button
										key={`${workspace.id}-${item.title}`}
										type="button"
										onClick={() => setView("chat")}
										className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${
											workspace.id === "main" && index === 0
												? "bg-inferay-surface-2 text-inferay-text"
												: "text-inferay-text-3 hover:bg-inferay-surface hover:text-inferay-text-2"
										}`}
									>
										<span
											className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[8px] ${
												item.type === "codex"
													? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
													: "border-amber-400/20 bg-amber-400/10 text-amber-200"
											}`}
										>
											{item.type === "codex" ? "C" : "A"}
										</span>
										<span className="min-w-0 flex-1">
											<span className="block truncate text-[9px] font-medium">
												{item.folder}
											</span>
											<span className="block truncate text-[8px] opacity-70">
												{item.title}
											</span>
										</span>
									</button>
								))}
							</div>
						</div>
					))}
				</div>

				<div className="mt-4 border-t border-inferay-border pt-2">
					{sidebarRoutes.map((route) => (
						<button
							key={route.id}
							type="button"
							onClick={() => setView(route.id)}
							className={`mb-1 flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[10px] font-medium ${
								view === route.id
									? "bg-inferay-surface-2 text-inferay-text"
									: "text-inferay-text-3 hover:bg-inferay-surface hover:text-inferay-text-2"
							}`}
						>
							<span className="w-4 shrink-0">{route.icon}</span>
							{route.label}
						</button>
					))}
				</div>
			</div>

			<div className="border-t border-inferay-border p-2">
				<button
					type="button"
					onClick={() => setView("profile")}
					className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-[10px] ${
						view === "profile"
							? "bg-inferay-surface-2 text-inferay-text"
							: "text-inferay-text-3 hover:bg-inferay-surface hover:text-inferay-text-2"
					}`}
				>
					<Icons.Profile />
					<span className="min-w-0 flex-1 truncate text-left">
						raymondreaming
					</span>
				</button>
			</div>
		</aside>
	);
}

function ShellHeader({
	view,
	setView,
	layoutMode,
	setLayoutMode,
}: {
	view: View;
	setView: (view: View) => void;
	layoutMode: "grid" | "rows";
	setLayoutMode: (mode: "grid" | "rows") => void;
}) {
	const isTerminalView = terminalViews.some((item) => item.id === view);
	return (
		<header className="flex h-12 shrink-0 items-center gap-3 border-b border-inferay-border bg-inferay-bg px-3">
			<div className="flex items-center gap-1">
				{terminalViews.map((tab) => (
					<AppButton
						key={tab.id}
						active={view === tab.id}
						onClick={() => setView(tab.id)}
					>
						<span className="mr-1.5">{tab.icon}</span>
						{tab.label}
					</AppButton>
				))}
				<AppButton
					active={view === "automations"}
					onClick={() => setView("automations")}
				>
					<span className="mr-1.5">
						<Icons.Workflow />
					</span>
					Automations
				</AppButton>
			</div>
			<span className="min-w-0 flex-1" />
			{isTerminalView && (
				<div className="flex items-center gap-2">
					{view === "chat" && (
						<>
							<div className="flex h-7 items-center gap-1 rounded-md border border-inferay-border bg-inferay-surface px-1.5">
								<span className="text-[8px] text-inferay-text-3">Col</span>
								<span className="rounded bg-inferay-bg px-1.5 py-0.5 font-mono text-[9px] text-inferay-text">
									3
								</span>
							</div>
							<div className="flex h-7 items-center gap-1 rounded-md border border-inferay-border bg-inferay-surface px-1.5">
								<span className="text-[8px] text-inferay-text-3">Row</span>
								<span className="rounded bg-inferay-bg px-1.5 py-0.5 font-mono text-[9px] text-inferay-text">
									1
								</span>
							</div>
							<div className="flex h-7 overflow-hidden rounded-md border border-inferay-border bg-inferay-surface">
								<button
									type="button"
									onClick={() => setLayoutMode("grid")}
									className={`flex w-7 items-center justify-center ${
										layoutMode === "grid"
											? "bg-inferay-surface-2 text-inferay-text"
											: "text-inferay-text-3"
									}`}
									title="Grid layout"
								>
									<Icons.Context />
								</button>
								<button
									type="button"
									onClick={() => setLayoutMode("rows")}
									className={`flex w-7 items-center justify-center border-l border-inferay-border ${
										layoutMode === "rows"
											? "bg-inferay-surface-2 text-inferay-text"
											: "text-inferay-text-3"
									}`}
									title="Rows layout"
								>
									<Icons.Stack />
								</button>
							</div>
						</>
					)}
					<button
						type="button"
						className="flex h-7 items-center gap-1.5 rounded-md border border-inferay-border bg-inferay-surface-2 px-2 text-[10px] font-semibold text-inferay-text hover:bg-inferay-surface"
					>
						New
						<Icons.Plus />
					</button>
					{view === "editor" && (
						<button
							type="button"
							className="flex h-7 w-7 items-center justify-center rounded-md border border-inferay-border bg-inferay-surface text-inferay-text-3"
							title="Enter zen mode"
						>
							<Icons.Expand />
						</button>
					)}
				</div>
			)}
		</header>
	);
}

function ChangesSidebar() {
	return (
		<aside className="flex w-56 shrink-0 flex-col border-l border-inferay-border bg-inferay-bg">
			<div className="flex h-9 items-center gap-1 border-b border-inferay-border px-2">
				<button className="h-6 rounded-md border border-inferay-border bg-inferay-surface-2 px-2 text-[9px] text-inferay-text">
					Git
				</button>
				<button className="h-6 rounded-md border border-transparent px-2 text-[9px] text-inferay-text-3">
					Activity
				</button>
				<span className="flex-1" />
				<span className="rounded-full bg-inferay-surface px-1.5 text-[8px] text-inferay-text-3">
					4
				</span>
			</div>
			<div className="min-h-0 flex-1 overflow-auto p-2">
				<div className="mb-1 flex items-center gap-1 text-[9px] font-medium text-inferay-text-2">
					<span className="rotate-90">
						<Icons.Chevron />
					</span>
					Unstaged
					<span className="ml-auto text-[8px] text-inferay-text-3">4</span>
				</div>
				<div className="space-y-1">
					{changes.map((file) => (
						<button
							type="button"
							key={file.name}
							className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-inferay-surface"
						>
							<span className="text-amber-300">
								<Icons.Edit />
							</span>
							<span className="min-w-0 flex-1">
								<span className="block truncate font-mono text-[9px] text-inferay-text">
									{file.name}
								</span>
								<span className="block truncate text-[8px] text-inferay-text-3">
									{file.path}
								</span>
							</span>
							<span className="text-[8px] text-inferay-text-3">
								{file.status}
							</span>
						</button>
					))}
				</div>
			</div>
			<div className="border-t border-inferay-border p-2">
				<input
					placeholder="Summary"
					className="mb-1 h-7 w-full rounded-md border border-inferay-border bg-inferay-surface px-2 text-[9px] text-inferay-text placeholder:text-inferay-text-3"
				/>
				<button className="flex h-7 w-full items-center justify-center gap-1 rounded-md border border-inferay-border bg-inferay-surface-2 text-[9px] font-medium text-inferay-text">
					<Icons.Check />
					Commit (0)
				</button>
			</div>
		</aside>
	);
}

function EditorView() {
	return (
		<div className="flex min-h-0 flex-1 overflow-hidden">
			<section className="w-[300px] shrink-0 border-r border-inferay-border">
				<ChatPanel />
			</section>
			<div className="flex min-w-0 flex-1 flex-col">
				<ShikiDiffViewer filePath="ChatComposer.tsx" />
				<div className="flex h-8 shrink-0 items-center gap-2 border-t border-inferay-border bg-inferay-bg px-3">
					<Icons.Terminal />
					<span className="text-[10px] font-medium text-inferay-text-2">
						Terminal
					</span>
					<span className="flex-1" />
					<span className="font-mono text-[8px] text-inferay-text-3">
						2 shells
					</span>
					<Icons.Chevron />
				</div>
			</div>
			<ChangesSidebar />
		</div>
	);
}

function ChangesView() {
	return (
		<div className="flex min-h-0 flex-1 overflow-hidden">
			<div className="w-60 shrink-0 border-r border-inferay-border bg-inferay-bg">
				<div className="flex h-9 items-center gap-2 border-b border-inferay-border px-3">
					<Icons.Git />
					<span className="text-[10px] font-semibold text-inferay-text">
						Changes
					</span>
					<span className="ml-auto rounded-full bg-inferay-surface px-1.5 text-[8px] text-inferay-text-3">
						4
					</span>
				</div>
				<div className="p-2">
					{changes.map((file, index) => (
						<button
							key={file.name}
							type="button"
							className={`mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${
								index === 0
									? "bg-inferay-surface-2 text-inferay-text"
									: "text-inferay-text-3 hover:bg-inferay-surface"
							}`}
						>
							<Icons.FilePlus />
							<span className="min-w-0 flex-1 truncate font-mono text-[9px]">
								{file.name}
							</span>
							<span className="text-[8px]">{file.status}</span>
						</button>
					))}
				</div>
			</div>
			<ShikiDiffViewer filePath="Inferay.tsx" />
		</div>
	);
}

function FilesView() {
	const [selectedCount, setSelectedCount] = useState(2);
	return (
		<div className="flex h-full min-w-0 items-start justify-center overflow-hidden bg-inferay-bg px-8 py-10">
			<section className="flex h-full w-full max-w-3xl flex-col gap-5">
				<div className="flex items-center gap-4">
					<h2 className="m-0 text-2xl font-semibold tracking-normal text-white">
						Files
					</h2>
					<label className="ml-auto flex h-8 w-56 items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3">
						<Icons.Search />
						<input
							type="search"
							placeholder="Search files"
							className="min-w-0 flex-1 bg-transparent text-[11px] text-inferay-text outline-none placeholder:text-inferay-text-3"
						/>
					</label>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						className="flex h-8 items-center gap-1.5 rounded-full border border-white bg-white px-3 text-[11px] font-semibold text-black disabled:opacity-45"
						disabled={selectedCount === 0}
					>
						<Icons.Chat />
						Start chat
					</button>
					<button
						type="button"
						className="flex h-8 items-center gap-1.5 rounded-full border border-red-400/30 px-3 text-[11px] font-semibold text-red-300 disabled:opacity-45"
						disabled={selectedCount === 0}
						onClick={() => setSelectedCount(0)}
					>
						<Icons.Close />
						Delete
					</button>
					<span className="ml-auto text-[11px] font-semibold text-inferay-text">
						{selectedCount} selected
					</span>
				</div>
				<div className="min-h-0 flex-1 overflow-hidden">
					<div className="grid h-8 grid-cols-[2.5rem_minmax(0,1fr)_8rem_6rem] items-center px-1 text-[11px] font-semibold text-inferay-text-2">
						<span />
						<span>Name</span>
						<span>Added</span>
						<span>Size</span>
					</div>
					<div className="min-h-0 overflow-y-auto">
						{fileRows.map((file) => (
							<div
								key={file.name}
								className={`grid min-h-[58px] grid-cols-[2.5rem_minmax(0,1fr)_8rem_6rem] items-center border-b border-white/[0.06] px-1 ${
									file.selected && selectedCount > 0
										? "rounded-md bg-white/10"
										: "hover:bg-white/[0.05]"
								}`}
							>
								<span
									className={`mx-auto flex h-4 w-4 items-center justify-center rounded border ${
										file.selected && selectedCount > 0
											? "border-white bg-white text-black"
											: "border-white/25 bg-white/10"
									}`}
								>
									{file.selected && selectedCount > 0 ? <Icons.Check /> : null}
								</span>
								<div className="flex min-w-0 items-center gap-3">
									<span
										className={`h-8 w-8 shrink-0 rounded-md border border-white/15 bg-gradient-to-br ${file.color}`}
									/>
									<span className="min-w-0 truncate text-[11px] font-semibold text-inferay-text">
										{file.name}
									</span>
								</div>
								<span className="text-[11px] font-medium text-inferay-text">
									{file.added}
								</span>
								<span className="text-[11px] font-medium text-inferay-text">
									{file.size}
								</span>
							</div>
						))}
					</div>
				</div>
			</section>
		</div>
	);
}

function SimplePage({
	title,
	icon,
	children,
}: {
	title: string;
	icon: ReactElement;
	children: ReactNode;
}) {
	return (
		<div className="flex h-full items-center justify-center bg-inferay-bg p-8">
			<div className="w-full max-w-2xl">
				<div className="mb-4 flex items-center gap-2">
					<span className="flex h-9 w-9 items-center justify-center rounded-lg border border-inferay-border bg-inferay-surface text-inferay-text-3">
						{icon}
					</span>
					<h2 className="m-0 text-xl font-semibold tracking-normal text-inferay-text">
						{title}
					</h2>
				</div>
				<div className="grid gap-2">{children}</div>
			</div>
		</div>
	);
}

function RouteBody({ view }: { view: View }) {
	if (view === "chat") return <ChatGridView />;
	if (view === "editor") return <EditorView />;
	if (view === "changes") return <ChangesView />;
	if (view === "graph") return <GraphView />;
	if (view === "files") return <FilesView />;
	if (view === "prompts") {
		return (
			<SimplePage title="Prompts" icon={<Icons.File />}>
				{["/review", "/explain", "/goal", "/bug"].map((item) => (
					<div
						key={item}
						className="rounded-md border border-inferay-border bg-inferay-surface px-3 py-2 font-mono text-[12px] text-inferay-text"
					>
						{item}
					</div>
				))}
			</SimplePage>
		);
	}
	if (view === "goals") {
		return (
			<SimplePage title="Goals" icon={<Icons.Check />}>
				<div className="rounded-md border border-inferay-border bg-inferay-surface px-3 py-2 text-[12px] text-inferay-text">
					Active goal: align the marketing site with the current app shell.
				</div>
			</SimplePage>
		);
	}
	if (view === "automations") {
		return (
			<SimplePage title="Automations" icon={<Icons.Workflow />}>
				{["Release checklist", "Vercel deploy watch", "Package audit"].map(
					(item) => (
						<div
							key={item}
							className="rounded-md border border-inferay-border bg-inferay-surface px-3 py-2 text-[12px] text-inferay-text"
						>
							{item}
						</div>
					)
				)}
			</SimplePage>
		);
	}
	if (view === "simulators") {
		return (
			<SimplePage title="Simulators" icon={<Icons.Image />}>
				<div className="rounded-md border border-inferay-border bg-inferay-surface px-3 py-2 text-[12px] text-inferay-text">
					iPhone 16 Pro · booted · screenshot ready
				</div>
			</SimplePage>
		);
	}
	return (
		<SimplePage title="Profile" icon={<Icons.Profile />}>
			<div className="rounded-md border border-inferay-border bg-inferay-surface px-3 py-2 text-[12px] text-inferay-text">
				Default agent: Codex · GPT-5.5 · Low reasoning
			</div>
		</SimplePage>
	);
}

export default function Inferay() {
	const [view, setView] = useState<View>("chat");
	const [layoutMode, setLayoutMode] = useState<"grid" | "rows">("grid");

	return (
		<section
			className="mb-24 animate-slide-up"
			style={{ animationDelay: "0.3s" }}
		>
			<div className="relative">
				<div
					className="absolute -inset-8 rounded-3xl opacity-60"
					style={{
						background:
							"radial-gradient(ellipse 80% 55% at 50% 45%, rgba(255,255,255,0.08), transparent 70%)",
						filter: "blur(35px)",
					}}
				/>
				<div
					className="relative overflow-hidden rounded-xl border border-black/40 bg-inferay-bg"
					style={{
						boxShadow:
							"inset 0 1px 0 rgba(255,255,255,0.1), 0 30px 90px rgba(0,0,0,0.58)",
					}}
				>
					<div className="flex h-6 items-center gap-1.5 bg-inferay-bg px-3">
						<span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
						<span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
						<span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
					</div>
					<div className="flex h-[650px] bg-inferay-bg">
						<Sidebar view={view} setView={setView} />
						<div className="flex min-w-0 flex-1 flex-col">
							<ShellHeader
								view={view}
								setView={setView}
								layoutMode={layoutMode}
								setLayoutMode={setLayoutMode}
							/>
							<main className="min-h-0 flex-1 overflow-hidden">
								<RouteBody view={view} />
							</main>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
