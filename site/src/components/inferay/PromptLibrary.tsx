import React, { useState } from "react";
import { Icons } from "./Icons";

type Prompt = {
	id: string;
	command: string;
	name: string;
	description: string;
	promptTemplate: string;
	category: string;
	tags: string[];
	isBuiltIn?: boolean;
	isNew?: boolean;
	executionCount: number;
};

const prompts: Prompt[] = [
	{
		id: "1",
		command: "explain",
		name: "Explain This Code",
		description: "Get a clear breakdown of what selected code does",
		promptTemplate:
			"Explain this code step by step, focusing on the logic and any patterns used:\n\n{args}",
		category: "code",
		tags: ["learning", "documentation"],
		isBuiltIn: true,
		executionCount: 847,
	},
	{
		id: "2",
		command: "bugs",
		name: "Find Bugs",
		description: "Scan for potential bugs and edge cases",
		promptTemplate:
			"Review this code for potential bugs, edge cases, and issues. List each problem with a suggested fix:\n\n{args}",
		category: "debug",
		tags: ["quality", "review"],
		isBuiltIn: true,
		executionCount: 623,
	},
	{
		id: "3",
		command: "types",
		name: "Add Type Safety",
		description: "Add TypeScript types to untyped code",
		promptTemplate:
			"Add comprehensive TypeScript types to this code. Use strict typing, avoid 'any', and add interfaces where appropriate:\n\n{args}",
		category: "refactor",
		tags: ["typescript", "types"],
		isBuiltIn: true,
		isNew: true,
		executionCount: 234,
	},
	{
		id: "4",
		command: "test",
		name: "Write Unit Tests",
		description: "Generate comprehensive test coverage",
		promptTemplate:
			"Write unit tests for this code using Jest. Cover happy paths, edge cases, and error scenarios:\n\n{args}",
		category: "test",
		tags: ["testing", "jest"],
		isBuiltIn: true,
		executionCount: 512,
	},
	{
		id: "5",
		command: "perf",
		name: "Optimize Performance",
		description: "Find and fix performance bottlenecks",
		promptTemplate:
			"Analyze this code for performance issues. Suggest optimizations for speed and memory usage:\n\n{args}",
		category: "refactor",
		tags: ["performance", "optimization"],
		isBuiltIn: true,
		isNew: true,
		executionCount: 189,
	},
	{
		id: "6",
		command: "docs",
		name: "Generate Docs",
		description: "Add JSDoc comments and documentation",
		promptTemplate:
			"Add comprehensive JSDoc documentation to this code. Include param descriptions, return types, and examples:\n\n{args}",
		category: "docs",
		tags: ["documentation", "jsdoc"],
		isBuiltIn: true,
		executionCount: 445,
	},
	{
		id: "7",
		command: "security",
		name: "Security Audit",
		description: "Check for security vulnerabilities",
		promptTemplate:
			"Audit this code for security vulnerabilities including XSS, injection, auth issues, and data exposure:\n\n{args}",
		category: "debug",
		tags: ["security", "audit"],
		isBuiltIn: true,
		executionCount: 298,
	},
	{
		id: "8",
		command: "simplify",
		name: "Simplify Logic",
		description: "Reduce complexity and improve readability",
		promptTemplate:
			"Simplify this code while maintaining functionality. Reduce nesting, extract functions, and improve naming:\n\n{args}",
		category: "refactor",
		tags: ["clean-code", "readability"],
		isBuiltIn: true,
		executionCount: 367,
	},
	{
		id: "u1",
		command: "api-pattern",
		name: "My API Pattern",
		description: "Convert to our team's API format with error handling",
		promptTemplate:
			"Refactor this to use our fetchAPI wrapper with proper error handling and loading states:\n\n{args}",
		category: "custom",
		tags: ["api", "team"],
		isBuiltIn: false,
		executionCount: 45,
	},
	{
		id: "u2",
		command: "hooks",
		name: "React to Hooks",
		description: "Convert class components to hooks",
		promptTemplate:
			"Convert this React class component to a functional component using hooks. Preserve all functionality:\n\n{args}",
		category: "custom",
		tags: ["react", "hooks"],
		isBuiltIn: false,
		executionCount: 23,
	},
];

const FILTER_OPTIONS = [
	{ value: "all", label: "All prompts" },
	{ value: "builtin", label: "Built-in" },
	{ value: "custom", label: "Custom" },
	{ value: "code", label: "Code" },
	{ value: "debug", label: "Debug" },
	{ value: "refactor", label: "Refactor" },
	{ value: "test", label: "Test" },
	{ value: "docs", label: "Docs" },
];

const CATEGORIES = [
	{ value: "code", label: "Code" },
	{ value: "debug", label: "Debug" },
	{ value: "refactor", label: "Refactor" },
	{ value: "test", label: "Test" },
	{ value: "docs", label: "Docs" },
	{ value: "custom", label: "Custom" },
];

function filterPrompts(
	items: Prompt[],
	filter: string,
	search: string
): Prompt[] {
	const needle = search.trim().toLowerCase();
	return items.filter((prompt) => {
		const matchesFilter =
			filter === "all" ||
			(filter === "builtin" && prompt.isBuiltIn) ||
			(filter === "custom" && !prompt.isBuiltIn) ||
			prompt.category === filter;
		if (!matchesFilter) return false;
		if (!needle) return true;
		return [
			prompt.command,
			prompt.name,
			prompt.description,
			prompt.category,
			...prompt.tags,
		].some((value) => value.toLowerCase().includes(needle));
	});
}

function FilterDropdown({
	filter,
	onFilterChange,
}: {
	filter: string;
	onFilterChange: (v: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const activeLabel =
		FILTER_OPTIONS.find((o) => o.value === filter)?.label || "All prompts";

	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex items-center gap-1.5 h-6 rounded-md border border-inferay-border bg-inferay-surface px-2 text-[9px] text-inferay-text-2 hover:bg-inferay-surface-2 transition-colors"
			>
				{activeLabel}
				<svg
					width="8"
					height="8"
					viewBox="0 0 8 8"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					className={`transition-transform ${open ? "rotate-180" : ""}`}
				>
					<path d="M1.5 3L4 5.5L6.5 3" />
				</svg>
			</button>
			{open && (
				<div className="absolute left-0 top-full mt-1 z-50 min-w-[120px] rounded-md border border-inferay-border bg-inferay-surface p-1 shadow-xl">
					{FILTER_OPTIONS.map((opt) => (
						<button
							type="button"
							key={opt.value}
							onClick={() => {
								onFilterChange(opt.value);
								setOpen(false);
							}}
							className={`w-full text-left rounded px-2 py-1 text-[9px] transition-colors ${
								filter === opt.value
									? "bg-inferay-surface-2 text-inferay-text"
									: "text-inferay-text-3 hover:bg-inferay-surface-2 hover:text-inferay-text-2"
							}`}
						>
							{opt.label}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

function PromptDetailPanel({
	prompt,
	isEditing,
	isCreating,
	onClose,
	onStartEdit,
	onCancelEdit,
}: {
	prompt: Prompt | null;
	isEditing: boolean;
	isCreating: boolean;
	onClose: () => void;
	onStartEdit: () => void;
	onCancelEdit: () => void;
}) {
	const [formCommand, setFormCommand] = useState(prompt?.command || "");
	const [formName, setFormName] = useState(prompt?.name || "");
	const [formDescription, setFormDescription] = useState(
		prompt?.description || ""
	);
	const [formTemplate, setFormTemplate] = useState(
		prompt?.promptTemplate || ""
	);
	const [formCategory, setFormCategory] = useState(
		prompt?.category || "custom"
	);
	const [formTags, setFormTags] = useState(prompt?.tags.join(", ") || "");

	const isEditMode = isEditing || isCreating;

	const labelCls =
		"text-[8px] font-medium uppercase tracking-wide text-inferay-text-3";
	const inputCls =
		"mt-1 w-full rounded-md bg-transparent border border-inferay-border px-2 py-1.5 text-[10px] text-inferay-text placeholder:text-inferay-text-3 outline-none focus:border-inferay-text-3";

	return (
		<div className="flex h-full flex-col bg-inferay-bg overflow-hidden">
			{/* Header */}
			<div className="flex items-center justify-between border-b border-inferay-border px-3 h-8">
				<div className="flex items-center gap-2">
					{isEditMode ? (
						<div className="flex items-center gap-0.5">
							<span className="text-inferay-text-3 font-mono text-[10px]">
								/
							</span>
							<input
								type="text"
								value={formCommand}
								onChange={(e) =>
									setFormCommand(
										e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")
									)
								}
								placeholder="command"
								className="w-20 rounded bg-inferay-surface py-0.5 px-1 text-[10px] font-mono text-inferay-text outline-none placeholder:text-inferay-text-3"
							/>
						</div>
					) : prompt ? (
						<span className="text-[10px] font-mono text-inferay-text">
							/{prompt.command}
						</span>
					) : null}
					{prompt?.isBuiltIn && !isCreating && (
						<span className="text-[7px] text-inferay-text-3/60 bg-inferay-surface px-1 py-0.5 rounded">
							built-in
						</span>
					)}
					{isCreating && (
						<span className="text-[7px] text-inferay-accent bg-inferay-accent/10 px-1 py-0.5 rounded">
							new
						</span>
					)}
				</div>
				<div className="flex items-center gap-0.5">
					{isCreating ? (
						<>
							<button
								type="button"
								onClick={onCancelEdit}
								className="h-5 px-1.5 rounded text-[9px] text-inferay-text-3 hover:bg-inferay-surface"
							>
								Cancel
							</button>
							<button
								type="button"
								className="h-5 px-1.5 rounded text-[9px] text-inferay-text bg-inferay-surface-2"
							>
								Create
							</button>
						</>
					) : isEditing ? (
						<>
							<button
								type="button"
								onClick={onCancelEdit}
								className="h-5 px-1.5 rounded text-[9px] text-inferay-text-3 hover:bg-inferay-surface"
							>
								Cancel
							</button>
							<button
								type="button"
								className="h-5 px-1.5 rounded text-[9px] text-inferay-text bg-inferay-surface-2"
							>
								Save
							</button>
						</>
					) : (
						<>
							<button
								type="button"
								onClick={onStartEdit}
								className="h-5 w-5 rounded flex items-center justify-center text-inferay-text-3 hover:bg-inferay-surface"
							>
								<Icons.Edit />
							</button>
							{prompt && !prompt.isBuiltIn && (
								<button
									type="button"
									className="h-5 w-5 rounded flex items-center justify-center text-inferay-text-3 hover:bg-inferay-surface"
								>
									<Icons.Close />
								</button>
							)}
						</>
					)}
					<button
						type="button"
						onClick={onClose}
						className="h-5 w-5 rounded flex items-center justify-center text-inferay-text-3 hover:bg-inferay-surface"
					>
						<Icons.Close />
					</button>
				</div>
			</div>

			{/* Body */}
			<div className="flex-1 overflow-y-auto p-3 space-y-3">
				<div className="flex gap-2">
					<div className="flex-1">
						<span className={labelCls}>Name</span>
						{isEditMode ? (
							<input
								type="text"
								value={formName}
								onChange={(e) => setFormName(e.target.value)}
								placeholder="Prompt name"
								className={inputCls}
							/>
						) : (
							<p className="mt-1 text-[10px] text-inferay-text">
								{prompt?.name}
							</p>
						)}
					</div>
					<div className="w-24">
						<span className={labelCls}>Category</span>
						{isEditMode ? (
							<select
								value={formCategory}
								onChange={(e) => setFormCategory(e.target.value)}
								className={inputCls}
							>
								{CATEGORIES.map((c) => (
									<option key={c.value} value={c.value}>
										{c.label}
									</option>
								))}
							</select>
						) : (
							<p className="mt-1 text-[10px] text-inferay-text-2">
								{prompt?.category}
							</p>
						)}
					</div>
				</div>

				<div>
					<span className={labelCls}>Description</span>
					{isEditMode ? (
						<textarea
							value={formDescription}
							onChange={(e) => setFormDescription(e.target.value)}
							rows={2}
							placeholder="What this prompt does"
							className={`${inputCls} resize-none`}
						/>
					) : (
						<p className="mt-1 text-[10px] text-inferay-text-2 leading-relaxed">
							{prompt?.description}
						</p>
					)}
				</div>

				<div>
					<span className={labelCls}>
						Template
						{isEditMode && (
							<span className="ml-1 normal-case font-normal text-inferay-text-3/50">
								use {"{args}"} for input
							</span>
						)}
					</span>
					{isEditMode ? (
						<textarea
							value={formTemplate}
							onChange={(e) => setFormTemplate(e.target.value)}
							placeholder="Enter prompt template..."
							rows={4}
							className="mt-1 w-full rounded-md bg-inferay-surface border border-inferay-border p-2 font-mono text-[9px] text-inferay-text placeholder:text-inferay-text-3 outline-none focus:border-inferay-text-3 resize-none leading-relaxed"
						/>
					) : (
						<div className="mt-1 rounded-md bg-inferay-surface border border-inferay-border p-2 font-mono text-[9px] text-inferay-text-2 whitespace-pre-wrap leading-relaxed max-h-[150px] overflow-y-auto">
							{prompt?.promptTemplate}
						</div>
					)}
				</div>

				<div>
					<span className={labelCls}>Tags</span>
					{isEditMode ? (
						<input
							type="text"
							value={formTags}
							onChange={(e) => setFormTags(e.target.value)}
							placeholder="code, review, quality"
							className={inputCls}
						/>
					) : prompt && prompt.tags.length > 0 ? (
						<div className="mt-1 flex flex-wrap gap-1">
							{prompt.tags.map((tag) => (
								<span
									key={tag}
									className="rounded bg-inferay-surface px-1.5 py-0.5 text-[8px] text-inferay-text-3"
								>
									{tag}
								</span>
							))}
						</div>
					) : (
						<p className="mt-1 text-[8px] text-inferay-text-3/50">No tags</p>
					)}
				</div>

				{!isEditMode && prompt && (
					<p className="text-[8px] text-inferay-text-3/50 tabular-nums">
						{prompt.executionCount} uses
					</p>
				)}
			</div>
		</div>
	);
}

export function PromptLibrary() {
	const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
	const [filter, setFilter] = useState("all");
	const [search, setSearch] = useState("");
	const [isEditing, setIsEditing] = useState(false);
	const [isCreating, setIsCreating] = useState(false);

	const filtered = filterPrompts(prompts, filter, search);

	const handleSelect = (p: Prompt) => {
		if (isEditing || isCreating) {
			setIsEditing(false);
			setIsCreating(false);
		}
		setSelectedPrompt(p);
	};

	const handleCreate = () => {
		setSelectedPrompt(null);
		setIsEditing(false);
		setIsCreating(true);
	};

	const handleClose = () => {
		setSelectedPrompt(null);
		setIsEditing(false);
		setIsCreating(false);
	};

	return (
		<div className="flex h-full w-full flex-col bg-inferay-bg">
			{/* Content */}
			<div className="flex flex-1 min-h-0 overflow-hidden">
				{/* Prompt grid */}
				<div className="flex-1 overflow-y-auto">
					{filtered.length === 0 ? (
						<div className="flex items-center justify-center h-full">
							<div className="text-center">
								<p className="text-[10px] text-inferay-text-3 mb-1">
									{search ? "No prompts found" : "No prompts yet"}
								</p>
								<p className="text-[8px] text-inferay-text-3/50">
									{search
										? "Try a different search"
										: "Create your first prompt"}
								</p>
							</div>
						</div>
					) : (
						<div
							className={`grid gap-2 p-3 ${
								selectedPrompt || isCreating ? "grid-cols-3" : "grid-cols-4"
							}`}
						>
							{filtered.map((prompt) => {
								const isActive = selectedPrompt?.id === prompt.id;
								return (
									<button
										type="button"
										key={prompt.id}
										onClick={() => handleSelect(prompt)}
										className={`text-left rounded-lg border p-2.5 transition-colors ${
											isActive
												? "border-inferay-border bg-inferay-surface-2"
												: "border-inferay-border/50 hover:bg-inferay-surface/50 hover:border-inferay-border"
										}`}
									>
										<div className="flex items-center gap-1.5 mb-1">
											<span className="text-[9px] font-mono font-medium text-inferay-text">
												/{prompt.command}
											</span>
											{prompt.isBuiltIn && (
												<span className="text-[6px] text-inferay-text-3/60 bg-inferay-surface px-1 py-0.5 rounded">
													built-in
												</span>
											)}
											{prompt.isNew && (
												<span className="text-[6px] text-inferay-accent bg-inferay-accent/10 px-1 py-0.5 rounded">
													new
												</span>
											)}
										</div>
										<p className="text-[9px] text-inferay-text-2 mb-0.5 truncate">
											{prompt.name}
										</p>
										<p className="text-[8px] text-inferay-text-3 line-clamp-2 leading-relaxed">
											{prompt.description}
										</p>
										{prompt.executionCount > 0 && (
											<p className="mt-1.5 text-[7px] tabular-nums text-inferay-text-3/50">
												{prompt.executionCount} uses
											</p>
										)}
									</button>
								);
							})}
						</div>
					)}
				</div>

				{/* Detail panel */}
				{(selectedPrompt || isCreating) && (
					<div className="w-[280px] shrink-0 border-l border-inferay-border overflow-y-auto bg-inferay-bg">
						<PromptDetailPanel
							prompt={selectedPrompt}
							isEditing={isEditing}
							isCreating={isCreating}
							onClose={handleClose}
							onStartEdit={() => setIsEditing(true)}
							onCancelEdit={() => {
								setIsEditing(false);
								setIsCreating(false);
							}}
						/>
					</div>
				)}
			</div>
		</div>
	);
}
