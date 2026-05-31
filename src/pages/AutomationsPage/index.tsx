import * as stylex from "@stylexjs/stylex";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	IconClock,
	IconEye,
	IconFilePlus,
	IconGlobe,
	IconPlus,
	IconRobot,
	IconTerminal,
	IconWorkflow,
} from "../../components/ui/Icons.tsx";
import {
	WorkspaceButton,
	WorkspaceContent,
	WorkspaceEmptyState,
	WorkspaceIconButton,
	WorkspacePage,
	WorkspaceToolbar,
	WorkspaceToolbarSpacer,
} from "../../components/ui/WorkspacePage.tsx";
import { createDocumentArtifact } from "../../features/artifacts/artifact-workspace-store.ts";
import type {
	AutomationFlow,
	AutomationNode,
	AutomationStatus,
	AutomationNodeKind as NodeKind,
} from "../../features/automations/types.ts";
import type { Prompt } from "../../features/prompts/types.ts";
import { usePrompts } from "../../features/prompts/usePrompts.ts";
import { loadQuickActions } from "../../features/quick-actions/quick-actions-store.ts";
import type { QuickActionProfile } from "../../features/quick-actions/types.ts";
import { useAsyncResource } from "../../hooks/useAsyncResource.ts";
import { hasId, isPresent, lacksId } from "../../lib/data.ts";
import { fetchJsonOr, sendJson } from "../../lib/fetch-json.ts";
import { listenWindowEvent } from "../../lib/react-events.ts";
import {
	color,
	controlSize,
	effect,
	font,
	motion,
	radius,
	shadow,
} from "../../tokens.stylex.ts";

interface NodeKindConfig {
	label: string;
	icon: typeof IconWorkflow;
	inputs: string[];
	outputs: string[];
	tone: "emerald" | "blue" | "purple" | "pink" | "amber" | "orange" | "cyan";
	hint: string;
	placeholder: string;
	autoDescription: string;
}

interface NodeDragState {
	nodeId: string;
	startClientX: number;
	startClientY: number;
	startX: number;
	startY: number;
	currentX: number;
	currentY: number;
	element: HTMLButtonElement;
	pointerId: number;
}

interface RunState {
	flowId: string;
	activeNodeId: string | null;
	completedNodeIds: string[];
	failedNodeId: string | null;
	isRunning: boolean;
	nodeOutputs: Record<string, string>;
}

interface WorkflowNodeTemplate {
	source: "quick-action" | "prompt";
	sourceId: string;
	kind: NodeKind;
	title: string;
	description: string;
	body: string;
	tags: string[];
	contextPaths?: string[];
	execution?: AutomationNode["execution"];
}

function compactLines(lines: Array<string | false | null | undefined>): string {
	return lines.filter(Boolean).join("\n");
}

function quickActionToWorkflowTemplate(
	profile: QuickActionProfile
): WorkflowNodeTemplate {
	return {
		source: "quick-action",
		sourceId: profile.id,
		kind: "agent",
		title: profile.name,
		description: profile.description,
		tags: profile.tags,
		contextPaths: profile.cwd ? [profile.cwd] : [],
		execution: {
			source: "quick-action",
			sourceId: profile.id,
			agentKind: profile.agentKind,
			model: profile.model,
			reasoningLevel: profile.reasoningLevel,
			useWorktree: profile.useWorktree,
		},
		body: compactLines([
			`Action profile: ${profile.name}`,
			profile.description ? `Purpose: ${profile.description}` : null,
			`Agent: ${profile.agentKind}`,
			`Model: ${profile.model}`,
			profile.reasoningLevel ? `Reasoning: ${profile.reasoningLevel}` : null,
			profile.cwd ? `Workspace: ${profile.cwd}` : "Workspace: choose at run",
			profile.useWorktree ? "Isolation: start in worktree" : null,
			"",
			"Prompt:",
			profile.prompt,
		]),
	};
}

function promptToWorkflowTemplate(
	prompt: Pick<
		Prompt,
		| "_id"
		| "name"
		| "description"
		| "command"
		| "promptTemplate"
		| "category"
		| "tags"
	>
): WorkflowNodeTemplate {
	return {
		source: "prompt",
		sourceId: prompt._id,
		kind: "prompt",
		title: prompt.name,
		description: prompt.description,
		tags: prompt.tags,
		execution: { source: "prompt", sourceId: prompt._id },
		body: compactLines([
			`Prompt command: /${prompt.command}`,
			prompt.description ? `Purpose: ${prompt.description}` : null,
			prompt.category ? `Category: ${prompt.category}` : null,
			"",
			"Template:",
			prompt.promptTemplate,
		]),
	};
}

function createAutomationNodeFromTemplate({
	template,
	flowId,
	index,
	x,
	y,
}: {
	template: WorkflowNodeTemplate;
	flowId: string;
	index: number;
	x: number;
	y: number;
}): AutomationNode {
	const safeTitle =
		template.title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 36) || template.kind;
	return {
		id: `${template.source}-${safeTitle}-${Date.now().toString(36)}`,
		kind: template.kind,
		title: template.title,
		description: template.description,
		x,
		y,
		file: `automations/${flowId}/${index.toString().padStart(2, "0")}-${safeTitle}.md`,
		contextPaths: template.contextPaths,
		body: template.body,
		output: "",
		execution: template.execution,
	};
}

function summarizeAutomationOutput(value: string, max = 4000): string {
	const trimmed = value.trim();
	return trimmed.length <= max
		? trimmed
		: `${trimmed.slice(0, max)}\n\n[Output truncated at ${max} characters]`;
}

function automationRunArtifactDraft(flow: AutomationFlow, run: RunState) {
	const status = run.isRunning
		? "running"
		: run.failedNodeId
			? "failed"
			: "completed";
	const completed = new Set(run.completedNodeIds);
	return {
		title: `Automation Run - ${flow.name}`,
		subtitle: `${status} · ${completed.size}/${flow.nodes.length} steps · ${flow.primaryPath || "No workspace"}`,
		content: [
			`# Automation Run: ${flow.name}`,
			"",
			`- Status: ${status}`,
			`- Workflow: ${flow.name}`,
			`- Schedule: ${flow.schedule}`,
			`- Workspace: ${flow.primaryPath || "Not set"}`,
			`- Saved: ${new Date().toLocaleString()}`,
			`- Steps: ${completed.size}/${flow.nodes.length}`,
			"",
			"## Summary",
			"",
			flow.description || "No workflow description.",
			"",
			"## Steps",
			"",
			...flow.nodes.flatMap((node, index) => {
				const output = run.nodeOutputs[node.id];
				return [
					`### ${index + 1}. ${node.title}`,
					"",
					`- Kind: ${node.kind}`,
					`- Status: ${
						node.id === run.failedNodeId
							? "failed"
							: completed.has(node.id)
								? "completed"
								: "not run"
					}`,
					node.execution?.agentKind
						? `- Agent: ${node.execution.agentKind}`
						: null,
					node.execution?.model ? `- Model: ${node.execution.model}` : null,
					node.execution?.reasoningLevel
						? `- Reasoning: ${node.execution.reasoningLevel}`
						: null,
					node.file ? `- File: ${node.file}` : null,
					node.body ? `- Instructions: ${node.body}` : null,
					"",
					output ? "Output:" : "Output: none recorded.",
					output ? "```text" : null,
					output ? summarizeAutomationOutput(output) : null,
					output ? "```" : null,
					"",
				].filter(isPresent);
			}),
		].join("\n"),
		projectPath: flow.primaryPath || null,
	};
}

const NODE_WIDTH = 200;
const NODE_PORT_TOP = 44;
const NODE_PORT_ROW_HEIGHT = 16;

const toolKinds: NodeKind[] = [
	"input",
	"web",
	"agent",
	"script",
	"note",
	"output",
];

const nodeKinds: Record<string, NodeKindConfig> = {
	input: {
		label: "Input",
		icon: IconFilePlus,
		inputs: [],
		outputs: ["out"],
		tone: "emerald",
		hint: "Watch a folder or receive data",
		placeholder:
			"Describe the folder to scan or the initial data to provide...",
		autoDescription:
			"Scans a folder and provides its contents to the next step",
	},
	web: {
		label: "Research",
		icon: IconGlobe,
		inputs: ["in"],
		outputs: ["findings"],
		tone: "purple",
		hint: "Fetch URLs and return findings",
		placeholder: "Enter URLs to fetch or describe what to search for...",
		autoDescription: "Fetches URLs and returns structured findings",
	},
	agent: {
		label: "Agent",
		icon: IconRobot,
		inputs: ["context"],
		outputs: ["result"],
		tone: "blue",
		hint: "Run a Claude agent with a prompt",
		placeholder: "Write the prompt for the Claude agent...",
		autoDescription: "Runs a Claude agent with the prompt below",
	},
	script: {
		label: "Script",
		icon: IconTerminal,
		inputs: ["in"],
		outputs: ["out"],
		tone: "amber",
		hint: "Execute a shell command",
		placeholder: "Enter the shell command to run...",
		autoDescription: "Executes a shell command and captures output",
	},
	note: {
		label: "Note",
		icon: IconWorkflow,
		inputs: ["in"],
		outputs: ["out"],
		tone: "blue",
		hint: "Pass through text instructions",
		placeholder: "Write instructions to pass to the next step...",
		autoDescription: "Passes these instructions to the next step",
	},
	output: {
		label: "Output",
		icon: IconEye,
		inputs: ["content"],
		outputs: [],
		tone: "cyan",
		hint: "Write the final result",
		placeholder: "Describe where and how to write the result...",
		autoDescription: "Writes the final result",
	},
	prompt: {
		label: "Prompt",
		icon: IconTerminal,
		inputs: ["in"],
		outputs: ["out"],
		tone: "blue",
		hint: "Send a prompt",
		placeholder: "Write a prompt...",
		autoDescription: "Sends a prompt",
	},
	research: {
		label: "Research",
		icon: IconGlobe,
		inputs: ["topic"],
		outputs: ["findings"],
		tone: "purple",
		hint: "Research a topic",
		placeholder: "Describe what to research...",
		autoDescription: "Researches a topic",
	},
	image: {
		label: "Image",
		icon: IconFilePlus,
		inputs: ["prompt"],
		outputs: ["image"],
		tone: "pink",
		hint: "Generate an image",
		placeholder: "Describe the image to generate...",
		autoDescription: "Generates an image",
	},
	code: {
		label: "Code",
		icon: IconTerminal,
		inputs: ["in"],
		outputs: ["patch"],
		tone: "amber",
		hint: "Write code",
		placeholder: "Describe the code to write...",
		autoDescription: "Writes code",
	},
	condition: {
		label: "Condition",
		icon: IconWorkflow,
		inputs: ["in"],
		outputs: ["pass", "fail"],
		tone: "orange",
		hint: "Branch on a condition",
		placeholder: "Describe the condition to check...",
		autoDescription: "Branches based on a condition",
	},
	shape: {
		label: "Shape",
		icon: IconEye,
		inputs: ["content"],
		outputs: ["out"],
		tone: "cyan",
		hint: "Transform output",
		placeholder: "Describe how to transform...",
		autoDescription: "Transforms the output",
	},
};

function getNodeConfig(kind: unknown): NodeKindConfig {
	if (typeof kind === "string" && kind in nodeKinds) {
		return nodeKinds[kind as NodeKind]!;
	}
	return nodeKinds.note!;
}

const defaultFlows: AutomationFlow[] = [createSampleFlow()];

function createSampleFlow(): AutomationFlow {
	const id = "research-summarizer";
	return {
		id,
		name: "Research Summarizer",
		description:
			"Watches a topic file, researches it on the web, and writes a summary.",
		schedule: "Manual",
		nextRun: "Manual",
		status: "ready",
		primaryPath: "~/Desktop",
		referencePaths: [],
		edges: [
			["topic", "research"],
			["research", "analyze"],
			["analyze", "format"],
			["format", "save"],
		],
		nodes: [
			{
				id: "topic",
				kind: "input",
				title: "Topic Source",
				description: "",
				x: 60,
				y: 160,
				file: `automations/${id}/00-topic.md`,
				body: "Read the topic from ~/Desktop/topics.md",
				output: "",
			},
			{
				id: "research",
				kind: "web",
				title: "Web Research",
				description: "",
				x: 320,
				y: 120,
				file: `automations/${id}/10-research.md`,
				body: "Search for the latest news and developments on the given topic. Return 3-5 key findings with source URLs.",
				output: "",
			},
			{
				id: "analyze",
				kind: "agent",
				title: "Analyze Findings",
				description: "",
				x: 580,
				y: 160,
				file: `automations/${id}/20-analyze.md`,
				body: "Review the research findings. Identify the most important trends and insights. Write a structured analysis with sections: Overview, Key Trends, Implications.",
				output: "",
			},
			{
				id: "format",
				kind: "note",
				title: "Format Instructions",
				description: "",
				x: 840,
				y: 120,
				file: `automations/${id}/30-format.md`,
				body: "Format the analysis as a clean markdown document with a title, date, and table of contents.",
				output: "",
			},
			{
				id: "save",
				kind: "output",
				title: "Save Report",
				description: "",
				x: 1100,
				y: 160,
				file: `automations/${id}/40-save.md`,
				body: "Write the formatted report to ~/Desktop/research-report.md",
				output: "",
			},
		],
	};
}

function getInputPortY(node: AutomationNode): number {
	return node.y + NODE_PORT_TOP;
}

function getOutputPortY(node: AutomationNode): number {
	const config = getNodeConfig(node.kind);
	return (
		node.y +
		NODE_PORT_TOP +
		Math.max(0, config.inputs.length) * NODE_PORT_ROW_HEIGHT
	);
}

function statusLabel(status: AutomationStatus) {
	if (status === "running") return "Running";
	if (status === "scheduled") return "Scheduled";
	return "Ready";
}

function isTextEditingTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false;
	const tagName = target.tagName.toLowerCase();
	return (
		target.isContentEditable ||
		tagName === "input" ||
		tagName === "select" ||
		tagName === "textarea"
	);
}

export function AutomationsPage() {
	const { prompts } = usePrompts();
	const { data: flows, setData: setFlows } = useAsyncResource(
		async () => {
			const payload = await fetchJsonOr<{ flows?: AutomationFlow[] }>(
				"/api/automations",
				{ flows: [] }
			);
			return Array.isArray(payload.flows) && payload.flows.length > 0
				? payload.flows
				: defaultFlows;
		},
		defaultFlows,
		[]
	);
	const [selectedFlowId, setSelectedFlowId] = useState(defaultFlows[0]!.id);
	const [selectedNodeId, setSelectedNodeId] = useState(
		defaultFlows[0]!.nodes[0]!.id
	);
	const [showGrid, setShowGrid] = useState(false);
	const [showAddMenu, setShowAddMenu] = useState(false);
	const [dragState, setDragState] = useState<NodeDragState | null>(null);
	const [runState, setRunState] = useState<RunState | null>(null);
	const [runArtifactStatus, setRunArtifactStatus] = useState<string | null>(
		null
	);
	const [quickActions, setQuickActions] = useState(loadQuickActions);
	const flowsRef = useRef(flows);
	const dragStateRef = useRef<NodeDragState | null>(null);
	const dragCleanupRef = useRef<(() => void) | null>(null);
	const dragFrameRef = useRef<number | null>(null);
	const edgePathRefs = useRef(new Map<string, SVGPathElement>());
	const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const selectedFlow =
		flows.find(hasId.bind(null, selectedFlowId)) ?? flows[0]!;
	const selectedNode =
		selectedFlow.nodes.find(hasId.bind(null, selectedNodeId)) ??
		selectedFlow.nodes[0]!;
	const selectedNodeConfig = getNodeConfig(selectedNode.kind);
	const outgoingNodes = selectedFlow.edges
		.filter(([fromId]) => fromId === selectedNode.id)
		.map(([, toId]) => selectedFlow.nodes.find(hasId.bind(null, toId)))
		.filter(isPresent);
	const workflowActions = useMemo(
		() => quickActions.slice(0, 6),
		[quickActions]
	);
	const workflowPrompts = useMemo(() => prompts.slice(0, 6), [prompts]);
	const canSaveRunArtifact =
		runState?.flowId === selectedFlow.id &&
		!runState.isRunning &&
		Object.keys(runState.nodeOutputs).length > 0;

	useEffect(() => {
		flowsRef.current = flows;
	}, [flows]);

	useEffect(() => {
		const refreshQuickActions = () => setQuickActions(loadQuickActions());
		return listenWindowEvent("storage", refreshQuickActions);
	}, []);

	useEffect(() => {
		return () => {
			if (dragFrameRef.current !== null) {
				window.cancelAnimationFrame(dragFrameRef.current);
			}
			dragCleanupRef.current?.();
		};
	}, []);

	const persistFlows = useCallback(
		(nextFlows: AutomationFlow[]) => {
			setFlows(nextFlows);
			flowsRef.current = nextFlows;
			if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
			persistTimerRef.current = setTimeout(() => {
				void sendJson(
					"/api/automations",
					{ flows: flowsRef.current },
					{ method: "PUT" }
				);
			}, 400);
		},
		[setFlows]
	);

	const persistFlowsNow = useCallback(
		async (nextFlows: AutomationFlow[]) => {
			setFlows(nextFlows);
			flowsRef.current = nextFlows;
			if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
			await sendJson(
				"/api/automations",
				{ flows: nextFlows },
				{ method: "PUT" }
			);
		},
		[setFlows]
	);

	const updateSelectedFlow = useCallback(
		(updater: (flow: AutomationFlow) => AutomationFlow) => {
			const nextFlows = flowsRef.current.map((flow) =>
				flow.id === selectedFlow.id ? updater(flow) : flow
			);
			persistFlows(nextFlows);
		},
		[persistFlows, selectedFlow.id]
	);

	const edgeLines = useMemo(() => {
		return selectedFlow.edges.flatMap(([fromId, toId]) => {
			const from = selectedFlow.nodes.find(hasId.bind(null, fromId));
			const to = selectedFlow.nodes.find(hasId.bind(null, toId));
			if (!from || !to) return [];
			return [
				{
					id: `${fromId}-${toId}`,
					fromId,
					toId,
					fromNode: from,
					toNode: to,
					x1: from.x + NODE_WIDTH,
					y1: getOutputPortY(from),
					x2: to.x,
					y2: getInputPortY(to),
				},
			];
		});
	}, [selectedFlow]);

	const buildEdgePath = (
		edge: (typeof edgeLines)[number],
		override?: { nodeId: string; x: number; y: number }
	) => {
		const x1 =
			override && edge.fromId === override.nodeId
				? override.x + NODE_WIDTH
				: edge.x1;
		const y1 =
			override && edge.fromId === override.nodeId
				? getOutputPortY({ ...edge.fromNode, x: override.x, y: override.y })
				: edge.y1;
		const x2 = override && edge.toId === override.nodeId ? override.x : edge.x2;
		const y2 =
			override && edge.toId === override.nodeId
				? getInputPortY({ ...edge.toNode, x: override.x, y: override.y })
				: edge.y2;
		return `M ${x1} ${y1} C ${x1 + 80} ${y1}, ${x2 - 80} ${y2}, ${x2} ${y2}`;
	};

	const selectFlow = (flow: AutomationFlow) => {
		setSelectedFlowId(flow.id);
		setSelectedNodeId(flow.nodes[0]?.id ?? "");
	};

	const handleAddWorkflow = async () => {
		const id = `workflow-${Date.now().toString(36)}`;
		const flow: AutomationFlow = {
			id,
			name: `Workflow ${flows.length + 1}`,
			description: "New workflow",
			schedule: "Manual",
			nextRun: "Manual",
			status: "ready",
			primaryPath: "~/Desktop",
			referencePaths: [],
			edges: [],
			nodes: [
				{
					id: `note-${Date.now().toString(36)}`,
					kind: "note",
					title: "Start",
					description: "",
					x: 200,
					y: 160,
					file: `automations/${id}/00-start.md`,
					body: "",
					output: "",
				},
			],
		};
		const nextFlows = [...flows, flow];
		await persistFlowsNow(nextFlows);
		setSelectedFlowId(flow.id);
		setSelectedNodeId(flow.nodes[0]!.id);
	};

	const handleAddNode = (kind: NodeKind) => {
		const config = getNodeConfig(kind);
		const node: AutomationNode = {
			id: `${kind}-${Date.now().toString(36)}`,
			kind,
			title: config.label,
			description: "",
			x: 440,
			y: 200,
			file: `automations/${selectedFlow.id}/${selectedFlow.nodes.length
				.toString()
				.padStart(2, "0")}-${kind}.md`,
			body: "",
			output: "",
		};
		updateSelectedFlow((flow) => ({
			...flow,
			nodes: [...flow.nodes, node],
		}));
		setSelectedNodeId(node.id);
		setShowAddMenu(false);
	};

	const addTemplateNode = useCallback(
		(template: WorkflowNodeTemplate) => {
			const sourceNode = selectedNode;
			const node = createAutomationNodeFromTemplate({
				template,
				flowId: selectedFlow.id,
				index: selectedFlow.nodes.length,
				x: sourceNode ? sourceNode.x + 260 : 240,
				y: sourceNode ? sourceNode.y : 180,
			});
			updateSelectedFlow((flow) => ({
				...flow,
				nodes: [...flow.nodes, node],
				edges: sourceNode
					? [...flow.edges, [sourceNode.id, node.id]]
					: flow.edges,
			}));
			setSelectedNodeId(node.id);
		},
		[
			selectedFlow.id,
			selectedFlow.nodes.length,
			selectedNode,
			updateSelectedFlow,
		]
	);

	const handleDeleteSelectedNode = useCallback(async () => {
		if (selectedFlow.nodes.length <= 1) return;
		const selectedIndex = selectedFlow.nodes.findIndex(
			(node) => node.id === selectedNode.id
		);
		if (selectedIndex === -1) return;
		const fallbackNode =
			selectedFlow.nodes[selectedIndex + 1] ??
			selectedFlow.nodes[selectedIndex - 1];
		if (!fallbackNode) return;
		const nextFlows = flowsRef.current.map((flow) => {
			if (flow.id !== selectedFlow.id) return flow;
			return {
				...flow,
				edges: flow.edges.filter(
					([fromId, toId]) =>
						fromId !== selectedNode.id && toId !== selectedNode.id
				),
				nodes: flow.nodes.filter(lacksId.bind(null, selectedNode.id)),
			};
		});
		setSelectedNodeId(fallbackNode.id);
		await persistFlowsNow(nextFlows);
	}, [persistFlowsNow, selectedFlow, selectedNode.id]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey ||
				(event.key !== "Delete" && event.key !== "Backspace") ||
				isTextEditingTarget(event.target)
			) {
				return;
			}
			event.preventDefault();
			void handleDeleteSelectedNode();
		};
		return listenWindowEvent("keydown", handleKeyDown);
	}, [handleDeleteSelectedNode]);

	useEffect(() => {
		const handleClick = () => {
			if (showAddMenu) setShowAddMenu(false);
		};
		if (showAddMenu) {
			window.addEventListener("click", handleClick, true);
			return () => window.removeEventListener("click", handleClick, true);
		}
	}, [showAddMenu]);

	const handleRunOnce = async () => {
		const nodes = selectedFlow.nodes;
		if (nodes.length < 1) return;
		setRunArtifactStatus(null);

		const state: RunState = {
			flowId: selectedFlow.id,
			activeNodeId: null,
			completedNodeIds: [],
			failedNodeId: null,
			isRunning: true,
			nodeOutputs: {},
		};
		setRunState(state);

		let previousOutput = "";

		for (const node of nodes) {
			const config = getNodeConfig(node.kind);
			state.activeNodeId = node.id;
			setRunState({ ...state });
			setSelectedNodeId(node.id);

			try {
				let result = "";

				if (
					node.kind === "agent" ||
					node.kind === "web" ||
					node.kind === "research"
				) {
					const systemHint = config.autoDescription;
					const prompt = [
						systemHint,
						previousOutput
							? `\nPrevious step output:\n${previousOutput.slice(0, 8000)}`
							: "",
						`\nInstructions:\n${node.body}`,
					].join("\n");

					const res = await sendJson(
						"/api/automations/run",
						{
							prompt,
							cwd: selectedFlow.primaryPath.replace(/^~/, ""),
							agentKind: node.execution?.agentKind,
							model: node.execution?.model,
							reasoningLevel: node.execution?.reasoningLevel,
						},
						{ method: "POST" }
					);
					const data = (await res.json()) as { result?: string };
					result = data.result ?? "";
				} else if (node.kind === "script" || node.kind === "code") {
					const prompt = `Execute this shell command and return its output:\n${node.body}${
						previousOutput
							? `\n\nContext from previous step:\n${previousOutput.slice(0, 4000)}`
							: ""
					}`;
					const res = await sendJson(
						"/api/automations/run",
						{
							prompt,
							cwd: selectedFlow.primaryPath.replace(/^~/, ""),
							agentKind: node.execution?.agentKind,
							model: node.execution?.model,
							reasoningLevel: node.execution?.reasoningLevel,
						},
						{ method: "POST" }
					);
					const data = (await res.json()) as { result?: string };
					result = data.result ?? "";
				} else {
					result = node.body;
					if (previousOutput) {
						result = `${previousOutput}\n\n${node.body}`;
					}
				}

				previousOutput = result;
				state.nodeOutputs[node.id] = result;
				state.completedNodeIds.push(node.id);
				setRunState({ ...state });
			} catch {
				state.failedNodeId = node.id;
				state.isRunning = false;
				state.activeNodeId = null;
				setRunState({ ...state });
				return;
			}
		}

		state.isRunning = false;
		state.activeNodeId = null;
		setRunState({ ...state });
	};

	const saveRunArtifact = useCallback(() => {
		if (!runState || runState.flowId !== selectedFlow.id) return;
		const draft = automationRunArtifactDraft(selectedFlow, runState);
		createDocumentArtifact({
			title: draft.title,
			subtitle: draft.subtitle,
			content: draft.content,
			sourcePaneId: null,
			sourceMessageId: null,
			sourceRole: "automation-run",
			projectPath: draft.projectPath,
		});
		setRunArtifactStatus("Saved run artifact.");
	}, [runState, selectedFlow]);

	const updateSelectedNodeBody = (body: string) => {
		updateSelectedFlow((flow) => ({
			...flow,
			nodes: flow.nodes.map((node) =>
				node.id === selectedNode.id ? { ...node, body } : node
			),
		}));
	};

	const updateSelectedNodeTitle = (title: string) => {
		updateSelectedFlow((flow) => ({
			...flow,
			nodes: flow.nodes.map((node) =>
				node.id === selectedNode.id ? { ...node, title } : node
			),
		}));
	};

	const updateNodePosition = (nodeId: string, x: number, y: number) => {
		const nextFlows = flowsRef.current.map((flow) =>
			flow.id === selectedFlow.id
				? {
						...flow,
						nodes: flow.nodes.map((node) =>
							node.id === nodeId
								? { ...node, x: Math.max(0, x), y: Math.max(0, y) }
								: node
						),
					}
				: flow
		);
		flowsRef.current = nextFlows;
		setFlows(nextFlows);
		return nextFlows;
	};

	const handleNodePointerDown = (
		event: ReactPointerEvent<HTMLButtonElement>,
		node: AutomationNode
	) => {
		event.preventDefault();
		dragCleanupRef.current?.();
		const element = event.currentTarget;
		element.setPointerCapture(event.pointerId);
		setSelectedNodeId(node.id);
		const nextDragState = {
			nodeId: node.id,
			startClientX: event.clientX,
			startClientY: event.clientY,
			startX: node.x,
			startY: node.y,
			currentX: node.x,
			currentY: node.y,
			element,
			pointerId: event.pointerId,
		};
		dragStateRef.current = nextDragState;
		setDragState(nextDragState);

		const handlePointerMove = (moveEvent: PointerEvent) => {
			const currentDragState = dragStateRef.current;
			if (
				!currentDragState ||
				currentDragState.nodeId !== node.id ||
				moveEvent.pointerId !== currentDragState.pointerId
			) {
				return;
			}
			const deltaX = moveEvent.clientX - currentDragState.startClientX;
			const deltaY = moveEvent.clientY - currentDragState.startClientY;
			currentDragState.currentX = Math.max(0, currentDragState.startX + deltaX);
			currentDragState.currentY = Math.max(0, currentDragState.startY + deltaY);
			if (dragFrameRef.current !== null) return;
			dragFrameRef.current = window.requestAnimationFrame(() => {
				dragFrameRef.current = null;
				const latestDragState = dragStateRef.current;
				if (!latestDragState || latestDragState.nodeId !== node.id) return;
				latestDragState.element.style.left = `${latestDragState.currentX}px`;
				latestDragState.element.style.top = `${latestDragState.currentY}px`;
				for (const edge of edgeLines) {
					if (
						edge.fromId !== latestDragState.nodeId &&
						edge.toId !== latestDragState.nodeId
					) {
						continue;
					}
					edgePathRefs.current.get(edge.id)?.setAttribute(
						"d",
						buildEdgePath(edge, {
							nodeId: latestDragState.nodeId,
							x: latestDragState.currentX,
							y: latestDragState.currentY,
						})
					);
				}
			});
		};

		const finishNodeDrag = (finishEvent: PointerEvent) => {
			const currentDragState = dragStateRef.current;
			if (
				!currentDragState ||
				currentDragState.nodeId !== node.id ||
				finishEvent.pointerId !== currentDragState.pointerId
			) {
				return;
			}
			dragCleanupRef.current?.();
			if (dragFrameRef.current !== null) {
				window.cancelAnimationFrame(dragFrameRef.current);
				dragFrameRef.current = null;
			}
			if (element.hasPointerCapture(currentDragState.pointerId)) {
				element.releasePointerCapture(currentDragState.pointerId);
			}
			const nextFlows = updateNodePosition(
				currentDragState.nodeId,
				currentDragState.currentX,
				currentDragState.currentY
			);
			dragStateRef.current = null;
			setDragState(null);
			void sendJson(
				"/api/automations",
				{ flows: nextFlows },
				{ method: "PUT" }
			);
		};

		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", finishNodeDrag);
		window.addEventListener("pointercancel", finishNodeDrag);
		dragCleanupRef.current = () => {
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", finishNodeDrag);
			window.removeEventListener("pointercancel", finishNodeDrag);
			dragCleanupRef.current = null;
		};
	};

	return (
		<WorkspacePage>
			<WorkspaceToolbar>
				<WorkspaceToolbarSpacer />
				<WorkspaceButton
					type="button"
					onClick={() => setShowGrid(!showGrid)}
					variant="ghost"
				>
					Grid
				</WorkspaceButton>
				<WorkspaceButton
					type="button"
					onClick={() => void handleRunOnce()}
					disabled={runState?.flowId === selectedFlow.id && runState.isRunning}
					variant="primary"
				>
					{runState?.flowId === selectedFlow.id && runState.isRunning
						? "Running"
						: "Run"}
				</WorkspaceButton>
				<WorkspaceIconButton
					type="button"
					onClick={() => void handleAddWorkflow()}
					title="New workflow"
				>
					<IconPlus size={13} />
				</WorkspaceIconButton>
			</WorkspaceToolbar>
			<WorkspaceContent padding="none">
				<div {...stylex.props(styles.root)}>
					<section {...stylex.props(styles.leftPane)}>
						<div {...stylex.props(styles.sectionHeader)}>
							<span {...stylex.props(styles.sectionTitle)}>Workflows</span>
							<span {...stylex.props(styles.sectionMeta)}>{flows.length}</span>
						</div>
						<div {...stylex.props(styles.flowList)}>
							{flows.map((flow) => (
								<button
									key={flow.id}
									type="button"
									onClick={() => selectFlow(flow)}
									{...stylex.props(
										styles.flowCard,
										flow.id === selectedFlow.id && styles.flowCardSelected
									)}
								>
									<span {...stylex.props(styles.flowTitleRow)}>
										<span {...stylex.props(styles.flowName)}>{flow.name}</span>
										<AutomationStatusPill status={flow.status} />
									</span>
									<span {...stylex.props(styles.flowDescription)}>
										{flow.description}
									</span>
									<span {...stylex.props(styles.flowMeta)}>
										<span>
											<IconClock size={11} />
											{flow.schedule}
										</span>
										<span>{flow.nodes.length} steps</span>
									</span>
								</button>
							))}
						</div>
						<WorkflowLibrarySection
							actions={workflowActions}
							prompts={workflowPrompts}
							onAddAction={(profile) =>
								addTemplateNode(quickActionToWorkflowTemplate(profile))
							}
							onAddPrompt={(prompt) =>
								addTemplateNode(promptToWorkflowTemplate(prompt))
							}
						/>
					</section>

					<section {...stylex.props(styles.canvasPane)}>
						<div {...stylex.props(styles.canvasToolbar)}>
							<div {...stylex.props(styles.toolbarTitle)}>
								<IconWorkflow size={14} />
								<span>{selectedFlow.name}</span>
							</div>
							<span {...stylex.props(styles.spacer)} />
							<span {...stylex.props(styles.canvasMeta)}>
								{selectedFlow.nodes.length} steps · {selectedFlow.schedule}
							</span>
							{canSaveRunArtifact ? (
								<WorkspaceButton
									type="button"
									variant="secondary"
									onClick={saveRunArtifact}
								>
									<IconFilePlus size={11} />
									Save Run
								</WorkspaceButton>
							) : null}
						</div>

						<div
							{...stylex.props(styles.canvas, showGrid && styles.canvasGrid)}
							aria-label="Automation canvas"
							role="region"
						>
							<div {...stylex.props(styles.addButtonWrap)}>
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										setShowAddMenu(!showAddMenu);
									}}
									{...stylex.props(styles.addButton)}
								>
									<IconPlus size={14} />
								</button>
								{showAddMenu && (
									<div
										{...stylex.props(styles.addMenu)}
										onClick={(e) => e.stopPropagation()}
									>
										{toolKinds.map((kind) => {
											const config = getNodeConfig(kind);
											const Icon = config.icon;
											return (
												<button
													key={kind}
													type="button"
													onClick={() => handleAddNode(kind)}
													{...stylex.props(styles.addMenuItem)}
												>
													<span
														{...stylex.props(
															styles.addMenuIcon,
															styles[`menuIcon${config.tone}`]
														)}
													>
														<Icon size={13} />
													</span>
													<span {...stylex.props(styles.addMenuText)}>
														<span {...stylex.props(styles.addMenuLabel)}>
															{config.label}
														</span>
														<span {...stylex.props(styles.addMenuHint)}>
															{config.hint}
														</span>
													</span>
												</button>
											);
										})}
									</div>
								)}
							</div>

							<svg
								{...stylex.props(styles.edgeLayer)}
								aria-hidden="true"
								width="1400"
								height="520"
							>
								{edgeLines.map((edge) => (
									<path
										key={edge.id}
										ref={(element) => {
											if (element) edgePathRefs.current.set(edge.id, element);
											else edgePathRefs.current.delete(edge.id);
										}}
										d={buildEdgePath(edge)}
										{...stylex.props(styles.edge)}
									/>
								))}
							</svg>

							{selectedFlow.nodes.map((node) => {
								const nodeConfig = getNodeConfig(node.kind);
								const Icon = nodeConfig.icon;
								const isRunActive =
									runState?.flowId === selectedFlow.id &&
									runState.activeNodeId === node.id;
								const isRunComplete =
									runState?.flowId === selectedFlow.id &&
									runState.completedNodeIds.includes(node.id);
								const isRunFailed =
									runState?.flowId === selectedFlow.id &&
									runState.failedNodeId === node.id;
								return (
									<button
										key={node.id}
										type="button"
										onPointerDown={(event) =>
											handleNodePointerDown(event, node)
										}
										{...stylex.props(
											styles.nodeCard,
											styles[`nodeTone${nodeConfig.tone}`],
											node.id === selectedNode.id && styles.nodeCardSelected,
											dragState?.nodeId === node.id && styles.nodeCardDragging,
											isRunActive && styles.nodeCardRunning,
											isRunComplete && styles.nodeCardComplete,
											isRunFailed && styles.nodeCardFailed
										)}
										style={{ left: node.x, top: node.y }}
									>
										<span {...stylex.props(styles.nodeHeader)}>
											<span
												{...stylex.props(
													styles.nodeIcon,
													styles[`nodeIcon${nodeConfig.tone}`]
												)}
											>
												<Icon size={13} />
											</span>
											<span {...stylex.props(styles.nodeTitle)}>
												{node.title}
											</span>
										</span>
										<span {...stylex.props(styles.nodePorts)}>
											{nodeConfig.inputs.length > 0 && (
												<span {...stylex.props(styles.nodeInputPort)}>
													<span {...stylex.props(styles.portDot)} />
												</span>
											)}
											{nodeConfig.outputs.length > 0 && (
												<span {...stylex.props(styles.nodeOutputPort)}>
													{isRunActive
														? "running..."
														: isRunComplete
															? "done"
															: ""}
													<span {...stylex.props(styles.portDot)} />
												</span>
											)}
										</span>
										{node.body && (
											<span {...stylex.props(styles.nodeBodyPreview)}>
												{node.body}
											</span>
										)}
									</button>
								);
							})}
						</div>
					</section>

					<aside {...stylex.props(styles.detailPane)}>
						<div {...stylex.props(styles.detailHeader)}>
							<span {...stylex.props(styles.kicker)}>
								{selectedNodeConfig.label}
							</span>
							<input
								type="text"
								value={selectedNode.title}
								onChange={(e) => updateSelectedNodeTitle(e.target.value)}
								{...stylex.props(styles.detailTitleInput)}
							/>
							<span {...stylex.props(styles.detailAutoDesc)}>
								{selectedNodeConfig.autoDescription}
							</span>
						</div>

						<div {...stylex.props(styles.detailBody)}>
							<textarea
								value={selectedNode.body}
								onChange={(e) => updateSelectedNodeBody(e.target.value)}
								placeholder={selectedNodeConfig.placeholder}
								{...stylex.props(styles.bodyEditor)}
							/>
							<span {...stylex.props(styles.feedsInto)}>
								{outgoingNodes.length > 0
									? `Feeds into ${outgoingNodes.map((n) => n.title).join(", ")}`
									: "Final step"}
							</span>
							{runArtifactStatus ? (
								<span {...stylex.props(styles.feedsInto)}>
									{runArtifactStatus}
								</span>
							) : null}
						</div>

						{runState?.nodeOutputs[selectedNode.id] && (
							<div {...stylex.props(styles.detailOutput)}>
								<span {...stylex.props(styles.kicker)}>Output</span>
								<div {...stylex.props(styles.outputText)}>
									{runState.nodeOutputs[selectedNode.id]!.slice(0, 2000)}
								</div>
							</div>
						)}
					</aside>
				</div>
			</WorkspaceContent>
		</WorkspacePage>
	);
}

function AutomationStatusPill({ status }: { status: AutomationStatus }) {
	const statusStyle =
		status === "scheduled"
			? styles.statusScheduled
			: status === "running"
				? styles.statusRunning
				: styles.statusReady;

	return (
		<span {...stylex.props(styles.statusPill, statusStyle)}>
			<span {...stylex.props(styles.statusDot)} />
			{statusLabel(status)}
		</span>
	);
}

function WorkflowLibrarySection({
	actions,
	prompts,
	onAddAction,
	onAddPrompt,
}: {
	actions: QuickActionProfile[];
	prompts: Prompt[];
	onAddAction: (profile: QuickActionProfile) => void;
	onAddPrompt: (prompt: Prompt) => void;
}) {
	return (
		<div {...stylex.props(styles.libraryShelf)}>
			<div {...stylex.props(styles.sectionHeader)}>
				<span {...stylex.props(styles.sectionTitle)}>Reusable pieces</span>
				<span {...stylex.props(styles.sectionMeta)}>Steps + prompts</span>
			</div>
			<div {...stylex.props(styles.libraryGroup)}>
				<span {...stylex.props(styles.libraryLabel)}>Saved steps</span>
				{actions.map((profile) => (
					<button
						key={profile.id}
						type="button"
						onClick={() => onAddAction(profile)}
						{...stylex.props(styles.libraryCard)}
					>
						<span {...stylex.props(styles.libraryCardTitle)}>
							{profile.name}
						</span>
						<span {...stylex.props(styles.libraryCardMeta)}>
							{profile.agentKind} · {profile.model}
						</span>
					</button>
				))}
				{actions.length === 0 ? (
					<div {...stylex.props(styles.libraryEmptyPanel)}>
						<WorkspaceEmptyState
							icon={<IconRobot size={14} />}
							title="No saved steps yet"
							description="Save reusable steps from prompts or sessions to compose workflows."
						/>
					</div>
				) : null}
			</div>
			<div {...stylex.props(styles.libraryGroup)}>
				<span {...stylex.props(styles.libraryLabel)}>Prompts</span>
				{prompts.map((prompt) => (
					<button
						key={prompt._id}
						type="button"
						onClick={() => onAddPrompt(prompt)}
						{...stylex.props(styles.libraryCard)}
					>
						<span {...stylex.props(styles.libraryCardTitle)}>
							/{prompt.command}
						</span>
						<span {...stylex.props(styles.libraryCardMeta)}>{prompt.name}</span>
					</button>
				))}
				{prompts.length === 0 ? (
					<div {...stylex.props(styles.libraryEmptyPanel)}>
						<WorkspaceEmptyState
							icon={<IconFilePlus size={14} />}
							title="No prompts loaded"
							description="Prompt Library entries appear here as reusable workflow steps."
						/>
					</div>
				) : null}
			</div>
		</div>
	);
}

const styles = stylex.create({
	root: {
		backgroundColor: color.background,
		color: color.textMain,
		display: "grid",
		gridTemplateColumns: "260px minmax(520px, 1fr) 300px",
		height: "100%",
		minWidth: 0,
		overflow: "hidden",
	},
	leftPane: {
		backgroundColor: color.background,
		borderRightColor: color.border,
		borderRightStyle: "solid",
		borderRightWidth: 1,
		display: "flex",
		flexDirection: "column",
		minHeight: 0,
		overflow: "hidden",
	},
	sectionHeader: {
		alignItems: "center",
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "flex",
		gap: controlSize._3,
		justifyContent: "space-between",
		paddingBlock: controlSize._3,
		paddingInline: controlSize._3,
	},
	sectionTitle: {
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
	},
	sectionMeta: {
		color: color.textMuted,
		fontSize: font.size_1,
	},
	kicker: {
		color: color.textMuted,
		display: "block",
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		textTransform: "uppercase",
	},
	flowList: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
		maxHeight: "42%",
		overflowY: "auto",
		padding: controlSize._3,
	},
	libraryShelf: {
		borderTopColor: color.border,
		borderTopStyle: "solid",
		borderTopWidth: 1,
		display: "flex",
		flex: 1,
		flexDirection: "column",
		minHeight: 0,
		overflowY: "auto",
	},
	libraryGroup: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
	},
	libraryLabel: {
		color: color.textMuted,
		fontSize: font.size_0_5,
		fontWeight: font.weight_6,
		textTransform: "uppercase",
	},
	libraryCard: {
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.surfaceControl,
		},
		backgroundImage: {
			default: effect.controlDepth,
			":hover": effect.controlDepthHover,
		},
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.controlDepth,
		display: "flex",
		flexDirection: "column",
		gap: controlSize._0_5,
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._2,
		textAlign: "left",
	},
	libraryCardTitle: {
		color: color.textMain,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	libraryCardMeta: {
		color: color.textMuted,
		fontSize: font.size_0_5,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	libraryEmptyPanel: {
		minHeight: "8rem",
	},
	flowCard: {
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.surfaceControl,
		},
		backgroundImage: {
			default: effect.controlDepth,
			":hover": effect.controlDepthHover,
		},
		borderColor: color.border,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
		padding: controlSize._3,
		textAlign: "left",
		transitionDuration: motion.durationBase,
		boxShadow: shadow.controlDepth,
		transitionProperty:
			"background-color, background-image, border-color, box-shadow",
		transitionTimingFunction: motion.ease,
	},
	flowCardSelected: {
		backgroundColor: color.surfaceControl,
		backgroundImage: effect.controlDepthHover,
		borderColor: "rgba(58, 132, 255, 0.42)",
		boxShadow:
			"inset 0 0 0 1px rgba(58, 132, 255, 0.12), 0 0 22px rgba(58, 132, 255, 0.08)",
	},
	flowTitleRow: {
		alignItems: "center",
		display: "flex",
		gap: controlSize._2,
		justifyContent: "space-between",
	},
	flowName: {
		color: color.textMain,
		fontSize: font.size_3,
		fontWeight: font.weight_6,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	flowDescription: {
		color: color.textMuted,
		fontSize: font.size_2,
		lineHeight: 1.4,
	},
	flowMeta: {
		alignItems: "center",
		color: color.textFaint,
		display: "flex",
		fontSize: font.size_1,
		gap: controlSize._2,
		justifyContent: "space-between",
	},
	canvasPane: {
		backgroundColor: color.background,
		display: "flex",
		flexDirection: "column",
		minHeight: 0,
		minWidth: 0,
		overflow: "hidden",
	},
	canvasToolbar: {
		alignItems: "center",
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		backgroundColor: color.background,
		display: "flex",
		gap: controlSize._2,
		height: controlSize._10,
		paddingInline: controlSize._3,
	},
	toolbarTitle: {
		alignItems: "center",
		color: color.textMain,
		display: "flex",
		fontSize: font.size_3,
		fontWeight: font.weight_6,
		gap: controlSize._2,
	},
	spacer: { flex: 1 },
	canvasMeta: {
		color: color.textMuted,
		fontSize: font.size_1,
	},
	canvas: {
		backgroundColor: color.background,
		flex: 1,
		minHeight: 0,
		overflow: "auto",
		position: "relative",
	},
	canvasGrid: {
		backgroundImage:
			"radial-gradient(circle at 1px 1px, rgba(255,255,255,0.038) 1px, transparent 0)",
		backgroundSize: "32px 32px",
	},
	addButtonWrap: {
		left: 16,
		position: "absolute",
		top: 16,
		zIndex: 5,
	},
	addButton: {
		alignItems: "center",
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.surfaceControl,
		},
		backgroundImage: {
			default: effect.controlDepth,
			":hover": effect.controlDepthHover,
		},
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.controlDepth,
		color: color.textMain,
		display: "flex",
		height: controlSize._8,
		justifyContent: "center",
		width: controlSize._8,
	},
	addMenu: {
		backdropFilter: "blur(16px)",
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.popoverDepth,
		borderColor: color.border,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.modal,
		display: "flex",
		flexDirection: "column",
		marginTop: controlSize._1,
		minWidth: 260,
		overflow: "hidden",
		padding: controlSize._1,
	},
	addMenuItem: {
		alignItems: "center",
		backgroundColor: {
			default: "transparent",
			":hover": color.surfaceControl,
		},
		backgroundImage: {
			default: "none",
			":hover": effect.controlDepth,
		},
		borderRadius: radius.md,
		color: color.textMain,
		display: "flex",
		gap: controlSize._2,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._2,
		textAlign: "left",
	},
	addMenuIcon: {
		alignItems: "center",
		backgroundImage: effect.controlDepth,
		borderStyle: "solid",
		borderWidth: 1,
		borderRadius: radius.sm,
		display: "flex",
		flexShrink: 0,
		height: controlSize._6,
		justifyContent: "center",
		width: controlSize._6,
	},
	menuIconemerald: {
		backgroundColor: "rgba(16, 185, 129, 0.1)",
		borderColor: "rgba(16, 185, 129, 0.28)",
		color: "rgba(167, 243, 208, 0.92)",
	},
	menuIconblue: {
		backgroundColor: "rgba(59, 130, 246, 0.1)",
		borderColor: "rgba(59, 130, 246, 0.28)",
		color: "rgba(191, 219, 254, 0.92)",
	},
	menuIconpurple: {
		backgroundColor: "rgba(168, 85, 247, 0.1)",
		borderColor: "rgba(168, 85, 247, 0.28)",
		color: "rgba(233, 213, 255, 0.92)",
	},
	menuIconamber: {
		backgroundColor: "rgba(245, 158, 11, 0.1)",
		borderColor: "rgba(245, 158, 11, 0.28)",
		color: "rgba(253, 230, 138, 0.92)",
	},
	menuIconcyan: {
		backgroundColor: "rgba(6, 182, 212, 0.1)",
		borderColor: "rgba(6, 182, 212, 0.28)",
		color: "rgba(165, 243, 252, 0.92)",
	},
	menuIconpink: {
		backgroundColor: "rgba(236, 72, 153, 0.1)",
		borderColor: "rgba(236, 72, 153, 0.28)",
		color: "rgba(251, 207, 232, 0.92)",
	},
	menuIconorange: {
		backgroundColor: "rgba(249, 115, 22, 0.1)",
		borderColor: "rgba(249, 115, 22, 0.28)",
		color: "rgba(254, 215, 170, 0.92)",
	},
	addMenuText: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		gap: 2,
		minWidth: 0,
	},
	addMenuLabel: {
		fontSize: font.size_2,
		fontWeight: font.weight_6,
	},
	addMenuHint: {
		color: color.textMuted,
		fontSize: font.size_1,
	},
	edgeLayer: {
		height: 520,
		left: 0,
		pointerEvents: "none",
		position: "absolute",
		top: 0,
		width: 1400,
	},
	edge: {
		fill: "none",
		stroke: color.borderControl,
		strokeWidth: 1.5,
	},
	nodeCard: {
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.surfaceControl,
		},
		backgroundImage: {
			default: effect.controlDepth,
			":hover": effect.controlDepthHover,
		},
		borderColor: color.border,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.controlDepth,
		cursor: "grab",
		display: "flex",
		flexDirection: "column",
		minHeight: 78,
		padding: 0,
		position: "absolute",
		textAlign: "left",
		touchAction: "none",
		transitionDuration: motion.durationBase,
		transitionProperty:
			"background-color, background-image, border-color, box-shadow, transform",
		transitionTimingFunction: motion.ease,
		userSelect: "none",
		width: NODE_WIDTH,
	},
	nodeToneemerald: {
		borderColor: color.border,
	},
	nodeToneblue: {
		borderColor: color.border,
	},
	nodeTonepurple: {
		borderColor: color.border,
	},
	nodeTonepink: {
		borderColor: color.border,
	},
	nodeToneamber: {
		borderColor: color.border,
	},
	nodeToneorange: {
		borderColor: color.border,
	},
	nodeTonecyan: {
		borderColor: color.border,
	},
	nodeCardSelected: {
		borderColor: "rgba(58, 132, 255, 0.58)",
		boxShadow:
			"inset 0 1px 14px rgba(0, 0, 0, 0.22), inset 0 -1px 0 rgba(255, 255, 255, 0.03), 0 0 0 1px rgba(58, 132, 255, 0.28), 0 0 26px rgba(58, 132, 255, 0.14), 0 12px 30px rgba(0, 0, 0, 0.36)",
	},
	nodeCardDragging: {
		borderColor: color.textSoft,
		cursor: "grabbing",
		willChange: "left, top",
		zIndex: 2,
	},
	nodeCardRunning: {
		borderColor: color.warningBorder,
		boxShadow: shadow.focusRing,
	},
	nodeCardComplete: {
		borderColor: "rgba(16, 185, 129, 0.6)",
	},
	nodeCardFailed: {
		borderColor: "rgba(239, 68, 68, 0.6)",
	},
	nodeHeader: {
		alignItems: "center",
		borderBottomColor: color.borderSubtle,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "flex",
		gap: controlSize._1_5,
		minWidth: 0,
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._2,
	},
	nodeIcon: {
		alignItems: "center",
		backgroundImage: effect.controlDepth,
		borderStyle: "solid",
		borderWidth: 1,
		borderRadius: radius.sm,
		display: "flex",
		flexShrink: 0,
		height: controlSize._4,
		justifyContent: "center",
		width: controlSize._4,
	},
	nodeIconemerald: {
		backgroundColor: "rgba(16, 185, 129, 0.1)",
		borderColor: "rgba(16, 185, 129, 0.28)",
		color: "rgba(167, 243, 208, 0.92)",
	},
	nodeIconblue: {
		backgroundColor: "rgba(59, 130, 246, 0.1)",
		borderColor: "rgba(59, 130, 246, 0.28)",
		color: "rgba(191, 219, 254, 0.92)",
	},
	nodeIconpurple: {
		backgroundColor: "rgba(168, 85, 247, 0.1)",
		borderColor: "rgba(168, 85, 247, 0.28)",
		color: "rgba(233, 213, 255, 0.92)",
	},
	nodeIconpink: {
		backgroundColor: "rgba(236, 72, 153, 0.1)",
		borderColor: "rgba(236, 72, 153, 0.28)",
		color: "rgba(251, 207, 232, 0.92)",
	},
	nodeIconamber: {
		backgroundColor: "rgba(245, 158, 11, 0.1)",
		borderColor: "rgba(245, 158, 11, 0.28)",
		color: "rgba(253, 230, 138, 0.92)",
	},
	nodeIconorange: {
		backgroundColor: "rgba(249, 115, 22, 0.1)",
		borderColor: "rgba(249, 115, 22, 0.28)",
		color: "rgba(254, 215, 170, 0.92)",
	},
	nodeIconcyan: {
		backgroundColor: "rgba(6, 182, 212, 0.1)",
		borderColor: "rgba(6, 182, 212, 0.28)",
		color: "rgba(165, 243, 252, 0.92)",
	},
	nodeTitle: {
		color: color.textMain,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	nodePorts: {
		alignItems: "center",
		display: "flex",
		justifyContent: "space-between",
		paddingBlock: controlSize._1,
		paddingInline: controlSize._1,
	},
	nodeInputPort: {
		alignItems: "center",
		color: color.textMuted,
		display: "flex",
		fontSize: font.size_1,
		gap: controlSize._1,
		marginLeft: "-0.625rem",
	},
	nodeOutputPort: {
		alignItems: "center",
		color: color.textMuted,
		display: "flex",
		fontSize: font.size_1,
		gap: controlSize._1,
		justifyContent: "flex-end",
		marginLeft: "auto",
		marginRight: "-0.625rem",
	},
	portDot: {
		backgroundColor: color.background,
		borderColor: color.borderControl,
		borderRadius: radius.pill,
		borderStyle: "solid",
		borderWidth: 2,
		display: "inline-flex",
		height: controlSize._2,
		width: controlSize._2,
	},
	nodeBodyPreview: {
		"-webkit-box-orient": "vertical",
		"-webkit-line-clamp": "2",
		borderTopColor: color.borderSubtle,
		borderTopStyle: "solid",
		borderTopWidth: 1,
		color: color.textFaint,
		display: "-webkit-box",
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		lineHeight: 1.4,
		overflow: "hidden",
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._2,
	},
	detailPane: {
		backgroundColor: color.background,
		borderLeftColor: color.border,
		borderLeftStyle: "solid",
		borderLeftWidth: 1,
		display: "flex",
		flexDirection: "column",
		minHeight: 0,
		overflow: "auto",
	},
	detailHeader: {
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		padding: controlSize._3,
	},
	detailTitleInput: {
		backgroundColor: "transparent",
		borderColor: {
			default: "transparent",
			":hover": color.borderSubtle,
			":focus": color.focusRing,
		},
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textMain,
		fontSize: font.size_5,
		fontWeight: font.weight_6,
		lineHeight: 1.25,
		outline: "none",
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._1,
		width: "100%",
	},
	detailAutoDesc: {
		color: color.textFaint,
		fontSize: font.size_1,
		paddingInline: controlSize._1,
	},
	detailBody: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		gap: controlSize._2,
		padding: controlSize._3,
	},
	bodyEditor: {
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.controlDepth,
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textMain,
		flex: 1,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
		lineHeight: 1.5,
		minHeight: 240,
		outline: {
			default: "none",
			":focus": "none",
		},
		boxShadow: shadow.controlDepth,
		padding: controlSize._2,
		resize: "vertical",
		width: "100%",
	},
	feedsInto: {
		color: color.textFaint,
		fontSize: font.size_1,
		paddingInline: controlSize._1,
	},
	detailOutput: {
		borderTopColor: color.border,
		borderTopStyle: "solid",
		borderTopWidth: 1,
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		maxHeight: 300,
		overflow: "auto",
		padding: controlSize._3,
	},
	outputText: {
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.controlDepth,
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		lineHeight: 1.5,
		maxHeight: 200,
		overflow: "auto",
		boxShadow: shadow.controlDepth,
		padding: controlSize._2,
		whiteSpace: "pre-wrap",
		wordBreak: "break-word",
	},
	statusPill: {
		alignItems: "center",
		borderRadius: radius.pill,
		borderStyle: "solid",
		borderWidth: 1,
		display: "inline-flex",
		flexShrink: 0,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		gap: controlSize._1,
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._2,
	},
	statusDot: {
		backgroundColor: "currentColor",
		borderRadius: radius.pill,
		height: controlSize._1,
		width: controlSize._1,
	},
	statusScheduled: {
		backgroundColor: color.warningWash,
		borderColor: color.warningBorder,
		color: color.warning,
	},
	statusRunning: {
		backgroundColor: color.accentWash,
		borderColor: color.accentBorder,
		color: color.accent,
	},
	statusReady: {
		backgroundColor: color.surfaceControl,
		borderColor: color.border,
		color: color.textMuted,
	},
});
