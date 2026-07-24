import React, { useCallback, useReducer, useRef, useState } from "react";
import { Icons } from "./Icons";

type NodeType =
	| "prompt"
	| "research"
	| "image"
	| "code"
	| "condition"
	| "output"
	| "input";

type WorkflowNode = {
	id: string;
	type: NodeType;
	title: string;
	x: number;
	y: number;
	config: Record<string, unknown>;
	inputs: string[];
	outputs: string[];
};

type Connection = {
	id: string;
	from: string;
	fromPort: string;
	to: string;
	toPort: string;
};

type SavedWorkflow = {
	id: string;
	name: string;
	description: string;
	nodeCount: number;
	lastEdited: string;
	status: "draft" | "active" | "completed";
};

type WorkflowBuilderState = {
	selectedNode: WorkflowNode | null;
	isRunning: boolean;
	activeWorkflowId: string;
};

type WorkflowBuilderAction =
	| { type: "selectedNodeChanged"; node: WorkflowNode | null }
	| { type: "runStarted" }
	| { type: "runFinished" }
	| { type: "activeWorkflowChanged"; id: string };

const initialWorkflowBuilderState: WorkflowBuilderState = {
	selectedNode: null,
	isRunning: false,
	activeWorkflowId: "wf1",
};

function workflowBuilderReducer(
	state: WorkflowBuilderState,
	action: WorkflowBuilderAction
): WorkflowBuilderState {
	switch (action.type) {
		case "selectedNodeChanged":
			return { ...state, selectedNode: action.node };
		case "runStarted":
			return { ...state, isRunning: true };
		case "runFinished":
			return { ...state, isRunning: false };
		case "activeWorkflowChanged":
			return { ...state, activeWorkflowId: action.id };
	}
}

const savedWorkflows: SavedWorkflow[] = [
	{
		id: "wf1",
		name: "Article Generator",
		description: "Research topic, generate image, write article",
		nodeCount: 5,
		lastEdited: "Just now",
		status: "active",
	},
	{
		id: "wf2",
		name: "Code Review Pipeline",
		description: "Analyze code, find bugs, suggest fixes",
		nodeCount: 4,
		lastEdited: "2h ago",
		status: "draft",
	},
	{
		id: "wf3",
		name: "Social Media Posts",
		description: "Generate content for multiple platforms",
		nodeCount: 6,
		lastEdited: "1d ago",
		status: "completed",
	},
	{
		id: "wf4",
		name: "Data Analysis",
		description: "Process CSV, analyze trends, create report",
		nodeCount: 5,
		lastEdited: "3d ago",
		status: "draft",
	},
];

const nodeTypes: Record<
	NodeType,
	{ label: string; color: string; icon: React.ReactNode }
> = {
	input: {
		label: "Input",
		color: "emerald",
		icon: <Icons.FilePlus />,
	},
	prompt: {
		label: "Prompt",
		color: "blue",
		icon: <Icons.Agent />,
	},
	research: {
		label: "Research",
		color: "purple",
		icon: <Icons.Search />,
	},
	image: {
		label: "Generate Image",
		color: "pink",
		icon: <Icons.Image />,
	},
	code: {
		label: "Code",
		color: "amber",
		icon: <Icons.Code />,
	},
	condition: {
		label: "Condition",
		color: "orange",
		icon: <Icons.Branch />,
	},
	output: {
		label: "Output",
		color: "cyan",
		icon: <Icons.Eye />,
	},
};

const initialNodes: WorkflowNode[] = [
	{
		id: "1",
		type: "input",
		title: "Topic Input",
		x: 80,
		y: 180,
		config: { value: "AI in healthcare" },
		inputs: [],
		outputs: ["out"],
	},
	{
		id: "2",
		type: "research",
		title: "Research Topic",
		x: 260,
		y: 120,
		config: { depth: "thorough", sources: 5 },
		inputs: ["topic"],
		outputs: ["findings"],
	},
	{
		id: "3",
		type: "image",
		title: "Generate Hero Image",
		x: 260,
		y: 240,
		config: { model: "flux-pro", style: "professional" },
		inputs: ["prompt"],
		outputs: ["image"],
	},
	{
		id: "4",
		type: "prompt",
		title: "Write Article",
		x: 460,
		y: 180,
		config: {
			model: "claude-opus",
			template: "Write an article about {{topic}} using {{findings}}",
		},
		inputs: ["findings", "image"],
		outputs: ["article"],
	},
	{
		id: "5",
		type: "output",
		title: "Final Output",
		x: 660,
		y: 180,
		config: { format: "markdown" },
		inputs: ["content"],
		outputs: [],
	},
];

const initialConnections: Connection[] = [
	{ id: "c1", from: "1", fromPort: "out", to: "2", toPort: "topic" },
	{ id: "c2", from: "1", fromPort: "out", to: "3", toPort: "prompt" },
	{ id: "c3", from: "2", fromPort: "findings", to: "4", toPort: "findings" },
	{ id: "c4", from: "3", fromPort: "image", to: "4", toPort: "image" },
	{ id: "c5", from: "4", fromPort: "article", to: "5", toPort: "content" },
];

function NodeComponent({
	node,
	isSelected,
	onSelect,
	onDrag,
	connections,
}: {
	node: WorkflowNode;
	isSelected: boolean;
	onSelect: () => void;
	onDrag: (id: string, x: number, y: number) => void;
	connections: Connection[];
}) {
	const nodeType = nodeTypes[node.type];
	const dragRef = useRef<{ startX: number; startY: number } | null>(null);

	const handleMouseDown = (e: React.MouseEvent) => {
		e.stopPropagation();
		onSelect();
		dragRef.current = {
			startX: e.clientX - node.x,
			startY: e.clientY - node.y,
		};

		const handleMouseMove = (e: MouseEvent) => {
			if (dragRef.current) {
				onDrag(
					node.id,
					e.clientX - dragRef.current.startX,
					e.clientY - dragRef.current.startY
				);
			}
		};

		const handleMouseUp = () => {
			dragRef.current = null;
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
	};

	const hasInputConnection = (port: string) =>
		connections.some((c) => c.to === node.id && c.toPort === port);
	const hasOutputConnection = (port: string) =>
		connections.some((c) => c.from === node.id && c.fromPort === port);

	const colorClasses: Record<string, string> = {
		emerald: "border-emerald-500/50 bg-emerald-500/5",
		blue: "border-blue-500/50 bg-blue-500/5",
		purple: "border-purple-500/50 bg-purple-500/5",
		pink: "border-pink-500/50 bg-pink-500/5",
		amber: "border-amber-500/50 bg-amber-500/5",
		orange: "border-orange-500/50 bg-orange-500/5",
		cyan: "border-cyan-500/50 bg-cyan-500/5",
	};

	const dotColors: Record<string, string> = {
		emerald: "bg-emerald-500",
		blue: "bg-blue-500",
		purple: "bg-purple-500",
		pink: "bg-pink-500",
		amber: "bg-amber-500",
		orange: "bg-orange-500",
		cyan: "bg-cyan-500",
	};

	return (
		<div
			className={`absolute select-none cursor-grab active:cursor-grabbing`}
			style={{ left: node.x, top: node.y }}
			onMouseDown={handleMouseDown}
		>
			<div
				className={`w-[140px] rounded-lg border ${colorClasses[nodeType.color]} ${
					isSelected
						? "ring-2 ring-inferay-accent ring-offset-1 ring-offset-inferay-bg"
						: ""
				} backdrop-blur-sm transition-shadow hover:shadow-lg`}
			>
				{/* Header */}
				<div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-inferay-border/30">
					<span
						className={`${dotColors[nodeType.color]} p-0.5 rounded text-white`}
					>
						{nodeType.icon}
					</span>
					<span className="text-[9px] font-medium text-inferay-text truncate">
						{node.title}
					</span>
				</div>

				{/* Ports */}
				<div className="px-2 py-1.5 space-y-1">
					{/* Input ports */}
					{node.inputs.map((input) => (
						<div key={input} className="flex items-center gap-1.5 -ml-4">
							<div
								className={`size-2 rounded-full border-2 ${
									hasInputConnection(input)
										? `${dotColors[nodeType.color]} border-inferay-bg`
										: "bg-inferay-bg border-inferay-border"
								}`}
							/>
							<span className="text-[8px] text-inferay-text-3">{input}</span>
						</div>
					))}

					{/* Output ports */}
					{node.outputs.map((output) => (
						<div
							key={output}
							className="flex items-center justify-end gap-1.5 -mr-4"
						>
							<span className="text-[8px] text-inferay-text-3">{output}</span>
							<div
								className={`size-2 rounded-full border-2 ${
									hasOutputConnection(output)
										? `${dotColors[nodeType.color]} border-inferay-bg`
										: "bg-inferay-bg border-inferay-border"
								}`}
							/>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

function ConnectionLine({
	from,
	to,
	nodes,
}: {
	from: { nodeId: string; port: string };
	to: { nodeId: string; port: string };
	nodes: WorkflowNode[];
}) {
	const fromNode = nodes.find((n) => n.id === from.nodeId);
	const toNode = nodes.find((n) => n.id === to.nodeId);
	if (!fromNode || !toNode) return null;

	const fromX = fromNode.x + 140;
	const fromPortIndex = fromNode.outputs.indexOf(from.port);
	const fromY =
		fromNode.y + 32 + fromNode.inputs.length * 16 + fromPortIndex * 16 + 8;

	const toX = toNode.x;
	const toPortIndex = toNode.inputs.indexOf(to.port);
	const toY = toNode.y + 32 + toPortIndex * 16 + 8;

	const midX = (fromX + toX) / 2;

	return (
		<path
			d={`M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`}
			fill="none"
			stroke="url(#connectionGradient)"
			strokeWidth="2"
			strokeLinecap="round"
		/>
	);
}

function WorkflowList({
	workflows,
	activeId,
	onSelect,
	onNew,
}: {
	workflows: SavedWorkflow[];
	activeId: string;
	onSelect: (id: string) => void;
	onNew?: () => void;
}) {
	return (
		<div className="w-[180px] shrink-0 border-r border-inferay-border flex flex-col bg-inferay-bg">
			{/* Header */}
			<div className="flex items-center justify-between px-3 h-9 border-b border-inferay-border">
				<span className="text-[10px] font-medium text-inferay-text">
					Workflows
				</span>
				<button
					onClick={onNew}
					className="p-1 rounded-md text-inferay-text-3 hover:bg-inferay-surface hover:text-inferay-text-2 transition-colors"
				>
					<Icons.Plus />
				</button>
			</div>

			{/* List */}
			<div className="flex-1 overflow-y-auto p-2 space-y-1.5">
				{workflows.map((wf) => (
					<button
						key={wf.id}
						onClick={() => onSelect(wf.id)}
						className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors ${
							activeId === wf.id
								? "border-inferay-border bg-inferay-surface-2"
								: "border-inferay-border/50 hover:bg-inferay-surface/50 hover:border-inferay-border"
						}`}
					>
						<div className="flex items-center gap-2">
							<span className="text-[10px] font-medium text-inferay-text truncate">
								{wf.name}
							</span>
							{wf.status === "active" && (
								<div className="size-1.5 rounded-full bg-inferay-accent shrink-0" />
							)}
						</div>
						<p className="text-[8px] text-inferay-text-3 truncate mt-0.5">
							{wf.description}
						</p>
						<div className="flex items-center gap-2 mt-1">
							<span className="text-[7px] text-inferay-text-3">
								{wf.nodeCount} nodes
							</span>
							<span className="text-[7px] text-inferay-text-3">
								{wf.lastEdited}
							</span>
						</div>
					</button>
				))}
			</div>
		</div>
	);
}

function NodePalette({ onAddNode }: { onAddNode: (type: NodeType) => void }) {
	return (
		<div className="absolute bottom-0 left-0 right-0 z-10 border-t border-inferay-border bg-inferay-bg/95 backdrop-blur-sm">
			<div className="flex items-center gap-1 px-3 py-2">
				<span className="text-[8px] font-medium uppercase tracking-wide text-inferay-text-3 mr-2">
					Add
				</span>
				{(
					Object.entries(nodeTypes) as [
						NodeType,
						(typeof nodeTypes)[NodeType],
					][]
				).map(([type, config]) => (
					<button
						key={type}
						onClick={() => onAddNode(type)}
						className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-inferay-border text-[9px] text-inferay-text-2 hover:bg-inferay-surface hover:text-inferay-text transition-colors"
					>
						<span className="text-inferay-text-3">{config.icon}</span>
						{config.label}
					</button>
				))}
			</div>
		</div>
	);
}

const fieldLabelClass =
	"text-[8px] font-medium uppercase tracking-wide text-inferay-text-3";
const inputClass =
	"mt-1 w-full h-7 rounded-md bg-inferay-surface border border-inferay-border px-2 text-[9px] text-inferay-text outline-none";

function ConfigField({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div>
			<label className={fieldLabelClass}>{label}</label>
			{children}
		</div>
	);
}

function SelectField({ label, options }: { label: string; options: string[] }) {
	return (
		<ConfigField label={label}>
			<select className={inputClass}>
				{options.map((option) => (
					<option key={option}>{option}</option>
				))}
			</select>
		</ConfigField>
	);
}

function NodeDetail({
	node,
	onClose,
	onUpdate,
}: {
	node: WorkflowNode;
	onClose: () => void;
	onUpdate: (config: Record<string, unknown>) => void;
}) {
	const nodeType = nodeTypes[node.type];

	return (
		<div className="flex h-full flex-col bg-inferay-bg">
			{/* Header */}
			<div className="flex items-center justify-between border-b border-inferay-border px-3 h-8">
				<div className="flex items-center gap-2">
					<span className="text-inferay-text-3">{nodeType.icon}</span>
					<span className="text-[10px] font-medium text-inferay-text">
						{node.title}
					</span>
				</div>
				<button
					type="button"
					onClick={onClose}
					className="p-1 rounded text-inferay-text-3 hover:bg-inferay-surface hover:text-inferay-text-2 transition-colors"
				>
					<Icons.Close />
				</button>
			</div>

			{/* Config */}
			<div className="flex-1 overflow-y-auto p-3 space-y-3">
				<div>
					<label className="text-[8px] font-medium uppercase tracking-wide text-inferay-text-3">
						Node Type
					</label>
					<p className="mt-1 text-[10px] text-inferay-text">{nodeType.label}</p>
				</div>

				{node.type === "prompt" && (
					<>
						<SelectField
							label="Model"
							options={["Claude Opus", "Claude Sonnet", "GPT-4"]}
						/>
						<ConfigField label="Prompt Template">
							<textarea
								aria-label="Prompt template"
								defaultValue={node.config.template as string}
								rows={4}
								className="mt-1 w-full rounded-md bg-inferay-surface border border-inferay-border px-2 py-1.5 text-[9px] text-inferay-text outline-none resize-none font-mono"
							/>
							<p className="mt-1 text-[7px] text-inferay-text-3">
								Use {"{{variable}}"} to reference inputs
							</p>
						</ConfigField>
					</>
				)}

				{node.type === "image" && (
					<>
						<SelectField
							label="Model"
							options={["Flux", "Flux Pro", "Flux Dev"]}
						/>
						<SelectField
							label="Style"
							options={[
								"Professional",
								"Artistic",
								"Photorealistic",
								"Illustration",
							]}
						/>
					</>
				)}

				{node.type === "research" && (
					<>
						<SelectField
							label="Depth"
							options={["Quick", "Thorough", "Deep"]}
						/>
						<ConfigField label="Max Sources">
							<input
								aria-label="Max sources"
								type="number"
								defaultValue={5}
								className={inputClass}
							/>
						</ConfigField>
					</>
				)}

				{node.type === "input" && (
					<ConfigField label="Default Value">
						<input
							aria-label="Default value"
							type="text"
							defaultValue={node.config.value as string}
							className={inputClass}
						/>
					</ConfigField>
				)}

				{node.type === "output" && (
					<SelectField
						label="Output Format"
						options={["Markdown", "HTML", "Plain Text", "JSON"]}
					/>
				)}

				{/* Inputs/Outputs info */}
				<div className="pt-2 border-t border-inferay-border">
					<span className="text-[8px] font-medium uppercase tracking-wide text-inferay-text-3">
						Connections
					</span>
					<div className="mt-1.5 space-y-1">
						{node.inputs.length > 0 && (
							<div className="flex items-center gap-2">
								<span className="text-[8px] text-inferay-text-3">Inputs:</span>
								<div className="flex gap-1">
									{node.inputs.map((i) => (
										<span
											key={i}
											className="px-1.5 py-0.5 rounded bg-inferay-surface border border-inferay-border text-[7px] font-mono text-inferay-text-2"
										>
											{i}
										</span>
									))}
								</div>
							</div>
						)}
						{node.outputs.length > 0 && (
							<div className="flex items-center gap-2">
								<span className="text-[8px] text-inferay-text-3">Outputs:</span>
								<div className="flex gap-1">
									{node.outputs.map((o) => (
										<span
											key={o}
											className="px-1.5 py-0.5 rounded bg-inferay-surface border border-inferay-border text-[7px] font-mono text-inferay-text-2"
										>
											{o}
										</span>
									))}
								</div>
							</div>
						)}
					</div>
				</div>
			</div>

			{/* Actions */}
			<div className="shrink-0 p-3 border-t border-inferay-border">
				<button
					type="button"
					className="w-full h-7 rounded-md border border-red-500/30 text-[9px] text-red-400 hover:bg-red-500/10 transition-colors"
				>
					Delete Node
				</button>
			</div>
		</div>
	);
}

export function WorkflowBuilder() {
	const [nodes, setNodes] = useState<WorkflowNode[]>(initialNodes);
	const connections = initialConnections;
	const workflows = savedWorkflows;
	const [builderState, dispatchBuilder] = useReducer(
		workflowBuilderReducer,
		initialWorkflowBuilderState
	);
	const { selectedNode, isRunning, activeWorkflowId } = builderState;
	const canvasRef = useRef<HTMLDivElement>(null);

	const activeWorkflow = workflows.find((w) => w.id === activeWorkflowId);

	const handleDrag = useCallback((id: string, x: number, y: number) => {
		setNodes((prev) =>
			prev.map((n) =>
				n.id === id ? { ...n, x: Math.max(0, x), y: Math.max(0, y) } : n
			)
		);
	}, []);

	const handleAddNode = (type: NodeType) => {
		// Get canvas center for new nodes
		const canvasWidth = canvasRef.current?.clientWidth || 800;
		const canvasHeight = canvasRef.current?.clientHeight || 500;
		const newNode: WorkflowNode = {
			id: Date.now().toString(),
			type,
			title: nodeTypes[type].label,
			x: (canvasWidth - 140) / 2,
			y: (canvasHeight - 80) / 2,
			config: {},
			inputs: type === "output" ? ["content"] : type === "input" ? [] : ["in"],
			outputs: type === "input" ? ["out"] : type === "output" ? [] : ["out"],
		};
		setNodes((prev) => [...prev, newNode]);
		dispatchBuilder({ type: "selectedNodeChanged", node: newNode });
	};

	const handleRun = () => {
		dispatchBuilder({ type: "runStarted" });
		setTimeout(() => dispatchBuilder({ type: "runFinished" }), 3000);
	};

	return (
		<div className="flex h-full w-full bg-inferay-bg">
			{/* Workflow List */}
			<WorkflowList
				workflows={workflows}
				activeId={activeWorkflowId}
				onSelect={(id) =>
					dispatchBuilder({ type: "activeWorkflowChanged", id })
				}
			/>

			{/* Main content */}
			<div className="flex-1 flex flex-col min-w-0">
				{/* Toolbar */}
				<div className="shrink-0 flex items-center gap-2 px-3 h-9 border-b border-inferay-border">
					<span className="text-[10px] font-medium text-inferay-text">
						{activeWorkflow?.name || "Untitled"}
					</span>
					<span className="text-[8px] text-inferay-text-3">
						{nodes.length} nodes
					</span>

					<div className="flex-1" />

					<button
						type="button"
						className="flex items-center gap-1 h-6 px-2 rounded-md border border-inferay-border text-[9px] text-inferay-text-3 hover:bg-inferay-surface transition-colors"
					>
						<Icons.Folder />
						Save
					</button>
					<button
						type="button"
						onClick={handleRun}
						disabled={isRunning}
						className="flex items-center gap-1.5 h-6 px-3 rounded-md bg-inferay-accent text-black text-[9px] font-medium hover:bg-inferay-accent/90 transition-colors disabled:opacity-50"
					>
						{isRunning ? (
							<>
								<div className="size-3 border-2 border-black/30 border-t-black rounded-full animate-spin" />
								Running…
							</>
						) : (
							<>
								<Icons.Play />
								Run Workflow
							</>
						)}
					</button>
				</div>

				{/* Content */}
				<div className="flex flex-1 min-h-0 overflow-hidden">
					{/* Canvas */}
					<div
						ref={canvasRef}
						className="flex-1 relative overflow-auto bg-black"
						style={{
							backgroundImage:
								"radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)",
							backgroundSize: "20px 20px",
						}}
						onClick={() =>
							dispatchBuilder({ type: "selectedNodeChanged", node: null })
						}
					>
						{/* Node palette */}
						<NodePalette onAddNode={handleAddNode} />

						{/* SVG for connections */}
						<svg className="absolute inset-0 w-full h-full pointer-events-none">
							<defs>
								<linearGradient
									id="connectionGradient"
									x1="0%"
									y1="0%"
									x2="100%"
									y2="0%"
								>
									<stop offset="0%" stopColor="rgba(255,255,255,0.3)" />
									<stop offset="100%" stopColor="rgba(255,255,255,0.1)" />
								</linearGradient>
							</defs>
							{connections.map((conn) => (
								<ConnectionLine
									key={conn.id}
									from={{ nodeId: conn.from, port: conn.fromPort }}
									to={{ nodeId: conn.to, port: conn.toPort }}
									nodes={nodes}
								/>
							))}
						</svg>

						{/* Nodes */}
						{nodes.map((node) => (
							<NodeComponent
								key={node.id}
								node={node}
								isSelected={selectedNode?.id === node.id}
								onSelect={() =>
									dispatchBuilder({ type: "selectedNodeChanged", node })
								}
								onDrag={handleDrag}
								connections={connections}
							/>
						))}

						{/* Running indicator */}
						{isRunning && (
							<div className="absolute bottom-14 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-lg bg-inferay-surface border border-inferay-border">
								<div className="size-2 rounded-full bg-inferay-accent animate-pulse" />
								<span className="text-[10px] text-inferay-text">
									Executing workflow…
								</span>
								<span className="text-[9px] text-inferay-text-3">
									Step 2 of 5
								</span>
							</div>
						)}
					</div>

					{/* Detail panel */}
					{selectedNode && (
						<div className="w-[220px] shrink-0 border-l border-inferay-border">
							<NodeDetail
								node={selectedNode}
								onClose={() =>
									dispatchBuilder({
										type: "selectedNodeChanged",
										node: null,
									})
								}
								onUpdate={(config) => {
									setNodes((prev) =>
										prev.map((n) =>
											n.id === selectedNode.id ? { ...n, config } : n
										)
									);
								}}
							/>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
