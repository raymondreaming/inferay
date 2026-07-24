import { useReducer, useState } from "react";
import { Icons } from "./Icons";

type Workspace = {
	id: string;
	name: string;
	description: string;
	model: string;
	layout: {
		sidebar: boolean;
		agent: boolean;
		splitAgent: boolean;
	};
	prompts: string[];
	isBuiltIn?: boolean;
	lastUsed?: string;
};

const workspaces: Workspace[] = [
	{
		id: "1",
		name: "Code Review",
		description: "Thorough code analysis with detailed feedback",
		model: "claude-opus",
		layout: { sidebar: true, agent: false, splitAgent: false },
		prompts: ["bugs", "security", "simplify"],
		isBuiltIn: true,
		lastUsed: "2h ago",
	},
	{
		id: "2",
		name: "Quick Tasks",
		description: "Fast responses for simple questions",
		model: "claude-haiku",
		layout: { sidebar: false, agent: true, splitAgent: false },
		prompts: ["explain", "types"],
		isBuiltIn: true,
		lastUsed: "1d ago",
	},
	{
		id: "3",
		name: "Debugging",
		description: "Deep debugging with agent output",
		model: "claude-sonnet",
		layout: { sidebar: true, agent: true, splitAgent: true },
		prompts: ["bugs", "explain", "perf"],
		isBuiltIn: true,
		lastUsed: "3d ago",
	},
	{
		id: "4",
		name: "Documentation",
		description: "Generate docs and comments",
		model: "claude-opus",
		layout: { sidebar: true, agent: false, splitAgent: false },
		prompts: ["docs", "explain"],
		isBuiltIn: true,
	},
	{
		id: "5",
		name: "Testing",
		description: "Write and run tests",
		model: "claude-sonnet",
		layout: { sidebar: false, agent: true, splitAgent: true },
		prompts: ["test", "bugs"],
		isBuiltIn: true,
	},
	{
		id: "6",
		name: "Refactoring",
		description: "Clean up and optimize code",
		model: "claude-opus",
		layout: { sidebar: true, agent: false, splitAgent: false },
		prompts: ["simplify", "perf", "types"],
		isBuiltIn: true,
	},
	{
		id: "u1",
		name: "Frontend Dev",
		description: "React/Next.js workflow",
		model: "claude-sonnet",
		layout: { sidebar: true, agent: true, splitAgent: false },
		prompts: ["hooks", "types"],
		isBuiltIn: false,
		lastUsed: "5h ago",
	},
	{
		id: "u2",
		name: "API Development",
		description: "Backend work with analysis",
		model: "claude-opus",
		layout: { sidebar: true, agent: true, splitAgent: true },
		prompts: ["api-pattern", "security"],
		isBuiltIn: false,
		lastUsed: "1w ago",
	},
];

const models: Record<string, { name: string; speed: string }> = {
	"claude-opus": { name: "Opus", speed: "Thorough" },
	"claude-sonnet": { name: "Sonnet", speed: "Balanced" },
	"claude-haiku": { name: "Haiku", speed: "Fast" },
	"gpt-4": { name: "GPT-4", speed: "Thorough" },
	"gpt-4-turbo": { name: "GPT-4 Turbo", speed: "Fast" },
};

type WorkspaceFormState = {
	name: string;
	description: string;
	model: string;
	sidebar: boolean;
	agent: boolean;
	split: boolean;
};

type WorkspaceFormAction =
	| { type: "nameChanged"; value: string }
	| { type: "descriptionChanged"; value: string }
	| { type: "modelChanged"; value: string }
	| { type: "sidebarChanged"; value: boolean }
	| { type: "agentChanged"; value: boolean }
	| { type: "splitChanged"; value: boolean };

const initialWorkspaceFormState: WorkspaceFormState = {
	name: "",
	description: "",
	model: "claude-sonnet",
	sidebar: true,
	agent: false,
	split: false,
};

function workspaceFormReducer(
	state: WorkspaceFormState,
	action: WorkspaceFormAction
): WorkspaceFormState {
	switch (action.type) {
		case "nameChanged":
			return { ...state, name: action.value };
		case "descriptionChanged":
			return { ...state, description: action.value };
		case "modelChanged":
			return { ...state, model: action.value };
		case "sidebarChanged":
			return { ...state, sidebar: action.value };
		case "agentChanged":
			return { ...state, agent: action.value };
		case "splitChanged":
			return { ...state, split: action.value };
	}
}

function WorkspaceRow({
	workspace,
	isActive,
	onSelect,
}: {
	workspace: Workspace;
	isActive: boolean;
	onSelect: () => void;
}) {
	const model = models[workspace.model];

	return (
		<button
			type="button"
			onClick={onSelect}
			className={`w-full flex items-center gap-3 px-3 py-2 border-b border-inferay-border transition-colors ${
				isActive ? "bg-inferay-surface-2" : "hover:bg-inferay-surface/50"
			}`}
		>
			{/* Icon */}
			<div className="size-6 rounded-md border border-inferay-border bg-inferay-surface flex items-center justify-center text-inferay-text-3">
				<Icons.Layers />
			</div>

			{/* Name & Description */}
			<div className="flex-1 min-w-0 text-left">
				<div className="flex items-center gap-1.5">
					<span className="text-[10px] font-medium text-inferay-text truncate">
						{workspace.name}
					</span>
					{workspace.isBuiltIn && (
						<span className="text-[7px] text-inferay-text-3 bg-inferay-surface px-1 py-0.5 rounded shrink-0">
							preset
						</span>
					)}
				</div>
				<p className="text-[8px] text-inferay-text-3 truncate">
					{workspace.description}
				</p>
			</div>

			{/* Model */}
			<div className="shrink-0 text-right">
				<span className="text-[9px] text-inferay-text-2">{model?.name}</span>
				<p className="text-[7px] text-inferay-text-3">{model?.speed}</p>
			</div>

			{/* Last used */}
			{workspace.lastUsed && (
				<span className="shrink-0 text-[7px] text-inferay-text-3 tabular-nums w-10 text-right">
					{workspace.lastUsed}
				</span>
			)}
		</button>
	);
}

function WorkspaceDetail({
	workspace,
	onClose,
	onActivate,
}: {
	workspace: Workspace;
	onClose: () => void;
	onActivate?: () => void;
}) {
	const model = models[workspace.model];

	return (
		<div className="flex h-full flex-col bg-inferay-bg">
			{/* Header */}
			<div className="flex items-center justify-between border-b border-inferay-border px-3 h-8">
				<span className="text-[10px] font-medium text-inferay-text">
					{workspace.name}
				</span>
				<button
					type="button"
					onClick={onClose}
					className="p-1 rounded text-inferay-text-3 hover:bg-inferay-surface hover:text-inferay-text-2 transition-colors"
				>
					<Icons.Close />
				</button>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto p-3 space-y-4">
				{/* Description */}
				<p className="text-[9px] text-inferay-text-2 leading-relaxed">
					{workspace.description}
				</p>

				{/* Model */}
				<div>
					<span className="text-[8px] font-medium uppercase tracking-wide text-inferay-text-3">
						Model
					</span>
					<div className="mt-1.5 flex items-center gap-2 px-2 py-1.5 rounded-md bg-inferay-surface border border-inferay-border">
						<span className="text-[9px] text-inferay-text">{model?.name}</span>
						<span className="text-[8px] text-inferay-text-3">
							{model?.speed}
						</span>
					</div>
				</div>

				{/* Layout */}
				<div>
					<span className="text-[8px] font-medium uppercase tracking-wide text-inferay-text-3">
						Layout
					</span>
					<div className="mt-1.5 flex items-center gap-1.5">
						<div
							className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[8px] ${
								workspace.layout.sidebar
									? "border-inferay-border bg-inferay-surface-2 text-inferay-text"
									: "border-inferay-border/50 text-inferay-text-3"
							}`}
						>
							<Icons.Layers />
							Sidebar
						</div>
						<div
							className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[8px] ${
								workspace.layout.agent
									? "border-inferay-border bg-inferay-surface-2 text-inferay-text"
									: "border-inferay-border/50 text-inferay-text-3"
							}`}
						>
							<Icons.Agent />
							Agent
						</div>
						{workspace.layout.agent && (
							<div
								className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[8px] ${
									workspace.layout.splitAgent
										? "border-inferay-border bg-inferay-surface-2 text-inferay-text"
										: "border-inferay-border/50 text-inferay-text-3"
								}`}
							>
								Split
							</div>
						)}
					</div>
				</div>

				{/* Prompts */}
				<div>
					<span className="text-[8px] font-medium uppercase tracking-wide text-inferay-text-3">
						Loaded Prompts
					</span>
					<div className="mt-1.5 flex flex-wrap gap-1">
						{workspace.prompts.map((prompt) => (
							<span
								key={prompt}
								className="px-1.5 py-0.5 rounded-md bg-inferay-surface border border-inferay-border text-[8px] font-mono text-inferay-text-2"
							>
								/{prompt}
							</span>
						))}
					</div>
				</div>
			</div>

			{/* Footer */}
			<div className="shrink-0 p-3 border-t border-inferay-border space-y-2">
				<button
					type="button"
					onClick={onActivate}
					className="w-full h-7 rounded-md bg-inferay-surface-2 border border-inferay-border text-[10px] font-medium text-inferay-text hover:bg-inferay-accent hover:text-black hover:border-inferay-accent transition-colors"
				>
					Activate Workspace
				</button>
				{!workspace.isBuiltIn && (
					<div className="flex items-center gap-2">
						<button
							type="button"
							className="flex-1 h-6 rounded-md border border-inferay-border text-[9px] text-inferay-text-3 hover:bg-inferay-surface transition-colors"
						>
							Edit
						</button>
						<button
							type="button"
							className="flex-1 h-6 rounded-md border border-inferay-border text-[9px] text-red-400 hover:bg-red-500/10 hover:border-red-500/30 transition-colors"
						>
							Delete
						</button>
					</div>
				)}
			</div>
		</div>
	);
}

function CreateWorkspacePanel({ onClose }: { onClose: () => void }) {
	const [formState, dispatchForm] = useReducer(
		workspaceFormReducer,
		initialWorkspaceFormState
	);
	const { name, description, model, sidebar, agent, split } = formState;

	const inputCls =
		"w-full rounded-md bg-inferay-surface border border-inferay-border px-2 py-1.5 text-[10px] text-inferay-text placeholder:text-inferay-text-3 outline-none focus:border-inferay-accent/50";

	return (
		<div className="flex h-full flex-col bg-inferay-bg">
			{/* Header */}
			<div className="flex items-center justify-between border-b border-inferay-border px-3 h-8">
				<span className="text-[10px] font-medium text-inferay-text">
					New Workspace
				</span>
				<button
					type="button"
					onClick={onClose}
					className="p-1 rounded text-inferay-text-3 hover:bg-inferay-surface hover:text-inferay-text-2 transition-colors"
				>
					<Icons.Close />
				</button>
			</div>

			{/* Form */}
			<div className="flex-1 overflow-y-auto p-3 space-y-3">
				<div>
					<label className="text-[8px] font-medium uppercase tracking-wide text-inferay-text-3">
						Name
					</label>
					<input
						aria-label="Workspace name"
						type="text"
						value={name}
						onChange={(e) =>
							dispatchForm({ type: "nameChanged", value: e.target.value })
						}
						placeholder="Workspace name"
						className={`mt-1 ${inputCls}`}
					/>
				</div>

				<div>
					<label className="text-[8px] font-medium uppercase tracking-wide text-inferay-text-3">
						Description
					</label>
					<input
						aria-label="Workspace description"
						type="text"
						value={description}
						onChange={(e) =>
							dispatchForm({
								type: "descriptionChanged",
								value: e.target.value,
							})
						}
						placeholder="What this workspace is for"
						className={`mt-1 ${inputCls}`}
					/>
				</div>

				<div>
					<label className="text-[8px] font-medium uppercase tracking-wide text-inferay-text-3">
						Model
					</label>
					<select
						value={model}
						onChange={(e) =>
							dispatchForm({ type: "modelChanged", value: e.target.value })
						}
						className={`mt-1 ${inputCls}`}
					>
						{Object.entries(models).map(([id, m]) => (
							<option key={id} value={id}>
								{m.name} ({m.speed})
							</option>
						))}
					</select>
				</div>

				<div>
					<label className="text-[8px] font-medium uppercase tracking-wide text-inferay-text-3">
						Layout
					</label>
					<div className="mt-1.5 space-y-1.5">
						<label className="flex items-center gap-2 text-[9px] text-inferay-text-2 cursor-pointer">
							<input
								type="checkbox"
								checked={sidebar}
								onChange={(e) =>
									dispatchForm({
										type: "sidebarChanged",
										value: e.target.checked,
									})
								}
								className="rounded border-inferay-border"
							/>
							Show sidebar
						</label>
						<label className="flex items-center gap-2 text-[9px] text-inferay-text-2 cursor-pointer">
							<input
								type="checkbox"
								checked={agent}
								onChange={(e) =>
									dispatchForm({
										type: "agentChanged",
										value: e.target.checked,
									})
								}
								className="rounded border-inferay-border"
							/>
							Show agent
						</label>
						{agent && (
							<label className="flex items-center gap-2 text-[9px] text-inferay-text-2 cursor-pointer pl-4">
								<input
									type="checkbox"
									checked={split}
									onChange={(e) =>
										dispatchForm({
											type: "splitChanged",
											value: e.target.checked,
										})
									}
									className="rounded border-inferay-border"
								/>
								Split agent
							</label>
						)}
					</div>
				</div>
			</div>

			{/* Footer */}
			<div className="shrink-0 p-3 border-t border-inferay-border">
				<button
					type="button"
					className="w-full h-7 rounded-md bg-inferay-surface-2 border border-inferay-border text-[10px] font-medium text-inferay-text hover:bg-inferay-accent hover:text-black hover:border-inferay-accent transition-colors"
				>
					Create Workspace
				</button>
			</div>
		</div>
	);
}

export function Workspaces() {
	const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(
		null
	);
	const [filter, setFilter] = useState<"all" | "preset" | "custom">("all");
	const [isCreating, setIsCreating] = useState(false);

	const filtered = workspaces.filter((w) => {
		if (filter === "preset") return w.isBuiltIn;
		if (filter === "custom") return !w.isBuiltIn;
		return true;
	});

	const handleSelect = (w: Workspace) => {
		setIsCreating(false);
		setSelectedWorkspace(w);
	};

	const handleCreate = () => {
		setSelectedWorkspace(null);
		setIsCreating(true);
	};

	const handleClose = () => {
		setSelectedWorkspace(null);
		setIsCreating(false);
	};

	return (
		<div className="flex h-full w-full flex-col bg-inferay-bg">
			{/* Toolbar */}
			<div className="shrink-0 flex items-center gap-2 px-3 h-8 border-b border-inferay-border">
				<div className="flex items-center gap-0.5">
					{(["all", "preset", "custom"] as const).map((f) => (
						<button
							key={f}
							onClick={() => setFilter(f)}
							className={`h-5 px-1.5 rounded-md text-[8px] font-medium transition-colors ${
								filter === f
									? "bg-inferay-surface-2 text-inferay-text border border-inferay-border"
									: "text-inferay-text-3 hover:text-inferay-text-2 border border-transparent"
							}`}
						>
							{f.charAt(0).toUpperCase() + f.slice(1)}
						</button>
					))}
				</div>

				<span className="text-[8px] tabular-nums text-inferay-text-3">
					{filtered.length}
				</span>

				<span className="flex-1" />

				<button
					type="button"
					onClick={handleCreate}
					className="flex items-center gap-1 h-6 rounded-md border border-inferay-border bg-inferay-surface px-2 text-[9px] text-inferay-text-2 hover:bg-inferay-surface-2 transition-colors"
				>
					<Icons.Plus />
					New
				</button>
			</div>

			{/* Content */}
			<div className="flex flex-1 min-h-0 overflow-hidden">
				{/* Workspace list */}
				<div className="flex-1 overflow-y-auto">
					{filtered.map((workspace) => (
						<WorkspaceRow
							key={workspace.id}
							workspace={workspace}
							isActive={selectedWorkspace?.id === workspace.id}
							onSelect={() => handleSelect(workspace)}
						/>
					))}
				</div>

				{/* Detail panel */}
				{selectedWorkspace && !isCreating && (
					<div className="w-[240px] shrink-0 border-l border-inferay-border">
						<WorkspaceDetail
							workspace={selectedWorkspace}
							onClose={handleClose}
						/>
					</div>
				)}

				{/* Create panel */}
				{isCreating && (
					<div className="w-[240px] shrink-0 border-l border-inferay-border">
						<CreateWorkspacePanel onClose={handleClose} />
					</div>
				)}
			</div>
		</div>
	);
}
