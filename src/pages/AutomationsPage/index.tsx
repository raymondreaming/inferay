import * as stylex from "@stylexjs/stylex";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useEffectEvent,
	useMemo,
	useRef,
	useReducer,
} from "react";
import {
	IconClock,
	IconEye,
	IconFilePlus,
	IconGlobe,
	IconPlus,
	IconRobot,
	IconAgent,
	IconWorkflow,
} from "../../components/ui/Icons.tsx";
import { useAsyncResource } from "../../hooks/useAsyncResource.ts";
import { hasId, lacksId } from "../../lib/data.ts";
import { fetchJsonOr, sendJson } from "../../lib/fetch-json.ts";
import { listenWindowEvent } from "../../lib/react-events.ts";
import {
	color,
	controlSize,
	font,
	motion,
	radius,
	shadow,
} from "../../tokens.stylex.ts";

type AutomationStatus = "ready" | "scheduled" | "running";
type NodeKind =
	| "input"
	| "prompt"
	| "research"
	| "image"
	| "code"
	| "condition"
	| "output"
	| "script"
	| "note"
	| "agent"
	| "web"
	| "shape";

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

interface AutomationFlow {
	id: string;
	name: string;
	description: string;
	schedule: string;
	nextRun: string;
	status: AutomationStatus;
	primaryPath: string;
	referencePaths: string[];
	nodes: AutomationNode[];
	edges: Array<[string, string]>;
}

interface AutomationNode {
	id: string;
	kind: NodeKind;
	title: string;
	description: string;
	x: number;
	y: number;
	file: string;
	contextPaths?: string[];
	body: string;
	output: string;
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

type AutomationsState = {
	selectedFlowId: string;
	selectedNodeId: string;
	showGrid: boolean;
	showAddMenu: boolean;
	dragState: NodeDragState | null;
	runState: RunState | null;
};

type AutomationsAction =
	| { type: "flowSelected"; flowId: string; nodeId: string }
	| { type: "nodeSelected"; nodeId: string }
	| { type: "showGridChanged"; value: boolean }
	| { type: "showAddMenuChanged"; value: boolean }
	| { type: "dragStateChanged"; value: NodeDragState | null }
	| { type: "runStateChanged"; value: RunState | null };

function getInitialAutomationsState(): AutomationsState {
	return {
		selectedFlowId: defaultFlows[0]!.id,
		selectedNodeId: defaultFlows[0]!.nodes[0]!.id,
		showGrid: false,
		showAddMenu: false,
		dragState: null,
		runState: null,
	};
}

function automationsReducer(
	state: AutomationsState,
	action: AutomationsAction
): AutomationsState {
	switch (action.type) {
		case "flowSelected":
			if (
				state.selectedFlowId === action.flowId &&
				state.selectedNodeId === action.nodeId
			)
				return state;
			return {
				...state,
				selectedFlowId: action.flowId,
				selectedNodeId: action.nodeId,
			};
		case "nodeSelected":
			return state.selectedNodeId === action.nodeId
				? state
				: { ...state, selectedNodeId: action.nodeId };
		case "showGridChanged":
			return state.showGrid === action.value
				? state
				: { ...state, showGrid: action.value };
		case "showAddMenuChanged":
			return state.showAddMenu === action.value
				? state
				: { ...state, showAddMenu: action.value };
		case "dragStateChanged":
			return state.dragState === action.value
				? state
				: { ...state, dragState: action.value };
		case "runStateChanged":
			return state.runState === action.value
				? state
				: { ...state, runState: action.value };
	}
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
		icon: IconAgent,
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
		icon: IconAgent,
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
		icon: IconAgent,
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

function areAutomationStringArraysEqual(prev: string[], next: string[]) {
	if (prev.length !== next.length) return false;
	for (let i = 0; i < prev.length; i++) {
		if (prev[i] !== next[i]) return false;
	}
	return true;
}

function areAutomationNodesEqual(
	prev: AutomationNode[],
	next: AutomationNode[]
) {
	if (prev.length !== next.length) return false;
	for (let i = 0; i < prev.length; i++) {
		const a = prev[i]!;
		const b = next[i]!;
		if (
			a.id !== b.id ||
			a.kind !== b.kind ||
			a.title !== b.title ||
			a.description !== b.description ||
			a.x !== b.x ||
			a.y !== b.y ||
			a.file !== b.file ||
			a.body !== b.body ||
			a.output !== b.output ||
			!areAutomationStringArraysEqual(
				a.contextPaths ?? [],
				b.contextPaths ?? []
			)
		) {
			return false;
		}
	}
	return true;
}

function areAutomationEdgesEqual(
	prev: Array<[string, string]>,
	next: Array<[string, string]>
) {
	if (prev.length !== next.length) return false;
	for (let i = 0; i < prev.length; i++) {
		const a = prev[i]!;
		const b = next[i]!;
		if (a[0] !== b[0] || a[1] !== b[1]) return false;
	}
	return true;
}

function areAutomationFlowsEqual(
	prev: AutomationFlow[],
	next: AutomationFlow[]
) {
	if (prev.length !== next.length) return false;
	for (let i = 0; i < prev.length; i++) {
		const a = prev[i]!;
		const b = next[i]!;
		if (
			a.id !== b.id ||
			a.name !== b.name ||
			a.description !== b.description ||
			a.schedule !== b.schedule ||
			a.nextRun !== b.nextRun ||
			a.status !== b.status ||
			a.primaryPath !== b.primaryPath ||
			!areAutomationStringArraysEqual(a.referencePaths, b.referencePaths) ||
			!areAutomationNodesEqual(a.nodes, b.nodes) ||
			!areAutomationEdgesEqual(a.edges, b.edges)
		) {
			return false;
		}
	}
	return true;
}

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

type AutomationEdgeLine = {
	fromId: string;
	toId: string;
	fromNode: AutomationNode;
	toNode: AutomationNode;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
};

function buildEdgePath(
	edge: AutomationEdgeLine,
	override?: { nodeId: string; x: number; y: number }
) {
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

function cleanupAutomationDrag({
	dragFrameRef,
	dragCleanupRef,
}: {
	dragFrameRef: { current: number | null };
	dragCleanupRef: { current: (() => void) | null };
}) {
	if (dragFrameRef.current !== null) {
		window.cancelAnimationFrame(dragFrameRef.current);
	}
	dragCleanupRef.current?.();
}

export function AutomationsPage() {
	const fetchAutomationFlows = useCallback(async () => {
		const payload = await fetchJsonOr<{ flows?: AutomationFlow[] }>(
			"/api/automations",
			{ flows: [] }
		);
		return Array.isArray(payload.flows) && payload.flows.length > 0
			? payload.flows
			: defaultFlows;
	}, []);
	const { data: flows, setData: setFlows } = useAsyncResource(
		fetchAutomationFlows,
		defaultFlows,
		{ isEqual: areAutomationFlowsEqual }
	);
	const [automationsState, automationsDispatch] = useReducer(
		automationsReducer,
		undefined,
		getInitialAutomationsState
	);
	const {
		selectedFlowId,
		selectedNodeId,
		showGrid,
		showAddMenu,
		dragState,
		runState,
	} = automationsState;
	const setSelectedFlow = useCallback((flowId: string, nodeId: string) => {
		automationsDispatch({ type: "flowSelected", flowId, nodeId });
	}, []);
	const setSelectedNodeId = useCallback((nodeId: string) => {
		automationsDispatch({ type: "nodeSelected", nodeId });
	}, []);
	const setShowGrid = useCallback((value: boolean) => {
		automationsDispatch({ type: "showGridChanged", value });
	}, []);
	const setShowAddMenu = useCallback((value: boolean) => {
		automationsDispatch({ type: "showAddMenuChanged", value });
	}, []);
	const setDragState = useCallback((value: NodeDragState | null) => {
		automationsDispatch({ type: "dragStateChanged", value });
	}, []);
	const setRunState = useCallback((value: RunState | null) => {
		automationsDispatch({ type: "runStateChanged", value });
	}, []);
	const flowsRef = useRef(flows);
	const dragStateRef = useRef<NodeDragState | null>(null);
	const dragCleanupRef = useRef<(() => void) | null>(null);
	const dragFrameRef = useRef<number | null>(null);
	const edgePathRefs = useRef<Map<string, SVGPathElement>>(
		undefined as unknown as Map<string, SVGPathElement>
	);
	if (!edgePathRefs.current) {
		edgePathRefs.current = new Map();
	}
	const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const selectedFlow =
		flows.find(hasId.bind(null, selectedFlowId)) ?? flows[0]!;
	const selectedNode =
		selectedFlow.nodes.find(hasId.bind(null, selectedNodeId)) ??
		selectedFlow.nodes[0]!;
	const selectedNodeConfig = getNodeConfig(selectedNode.kind);
	const outgoingNodes = selectedFlow.edges.flatMap(([fromId, toId]) => {
		if (fromId !== selectedNode.id) return [];
		const node = selectedFlow.nodes.find(hasId.bind(null, toId));
		return node ? [node] : [];
	});

	useEffect(() => {
		flowsRef.current = flows;
	}, [flows]);

	useEffect(() => {
		return () => {
			cleanupAutomationDrag({ dragFrameRef, dragCleanupRef });
		};
	}, []);

	const persistFlows = useCallback(
		(nextFlows: AutomationFlow[]) => {
			if (areAutomationFlowsEqual(flowsRef.current, nextFlows)) return;
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
			if (areAutomationFlowsEqual(flowsRef.current, nextFlows)) return;
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

	const selectFlow = (flow: AutomationFlow) => {
		setSelectedFlow(flow.id, flow.nodes[0]?.id ?? "");
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
		setSelectedFlow(flow.id, flow.nodes[0]!.id);
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
	}, [persistFlowsNow, selectedFlow, selectedNode.id, setSelectedNodeId]);

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

	const closeAddMenuEvent = useEffectEvent(() => setShowAddMenu(false));

	useEffect(() => {
		const handleClick = (e: MouseEvent) => {
			if (showAddMenu) closeAddMenuEvent();
		};
		if (showAddMenu) {
			window.addEventListener("click", handleClick, true);
			return () => window.removeEventListener("click", handleClick, true);
		}
	}, [showAddMenu]);

	const handleRunOnce = async () => {
		const nodes = selectedFlow.nodes;
		if (nodes.length < 1) return;

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
						{ prompt, cwd: selectedFlow.primaryPath.replace(/^~/, "") },
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
			} catch (err) {
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
		<div {...stylex.props(styles.root)}>
			<section {...stylex.props(styles.leftPane)}>
				<div {...stylex.props(styles.header)}>
					<div {...stylex.props(styles.titleBlock)}>
						<span {...stylex.props(styles.kicker)}>Automations</span>
						<h1 {...stylex.props(styles.title)}>Workflows</h1>
					</div>
					<button
						type="button"
						onClick={() => void handleAddWorkflow()}
						title="New workflow"
						{...stylex.props(styles.iconAction)}
					>
						<IconPlus size={13} />
					</button>
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
			</section>

			<section {...stylex.props(styles.canvasPane)}>
				<div {...stylex.props(styles.canvasToolbar)}>
					<div {...stylex.props(styles.toolbarTitle)}>
						<IconWorkflow size={14} />
						<span>{selectedFlow.name}</span>
					</div>
					<span {...stylex.props(styles.spacer)} />
					<button
						type="button"
						onClick={() => setShowGrid(!showGrid)}
						{...stylex.props(styles.smallButton)}
					>
						Grid
					</button>
					<button
						type="button"
						onClick={() => void handleRunOnce()}
						disabled={
							runState?.flowId === selectedFlow.id && runState.isRunning
						}
						{...stylex.props(styles.primaryButton)}
					>
						{runState?.flowId === selectedFlow.id && runState.isRunning
							? "Running..."
							: "Run"}
					</button>
				</div>

				<section
					{...stylex.props(styles.canvas, showGrid && styles.canvasGrid)}
					aria-label="Automation canvas"
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
								onPointerDown={(event) => handleNodePointerDown(event, node)}
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
									<span {...stylex.props(styles.nodeTitle)}>{node.title}</span>
								</span>
								<span {...stylex.props(styles.nodePorts)}>
									{nodeConfig.inputs.length > 0 && (
										<span {...stylex.props(styles.nodeInputPort)}>
											<span {...stylex.props(styles.portDot)} />
										</span>
									)}
									{nodeConfig.outputs.length > 0 && (
										<span {...stylex.props(styles.nodeOutputPort)}>
											{isRunActive ? "running..." : isRunComplete ? "done" : ""}
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
				</section>
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

const styles = stylex.create({
	root: {
		backgroundColor: color.transparent,
		color: color.textMain,
		display: "grid",
		gridTemplateColumns: "260px minmax(520px, 1fr) 300px",
		height: "100%",
		minWidth: 0,
		overflow: "hidden",
	},
	leftPane: {
		borderRightColor: color.border,
		borderRightStyle: "solid",
		borderRightWidth: 1,
		display: "flex",
		flexDirection: "column",
		minHeight: 0,
		overflow: "hidden",
	},
	header: {
		alignItems: "center",
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "flex",
		gap: controlSize._3,
		paddingBlock: controlSize._3,
		paddingInline: controlSize._3,
	},
	titleBlock: {
		flex: 1,
		minWidth: 0,
	},
	kicker: {
		color: color.textMuted,
		display: "block",
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		textTransform: "uppercase",
	},
	title: {
		color: color.textMain,
		fontSize: font.size_5,
		fontWeight: font.weight_6,
		lineHeight: 1.25,
		margin: 0,
		marginTop: controlSize._0_5,
	},
	iconAction: {
		alignItems: "center",
		backgroundColor: {
			default: color.surfaceControl,
			":hover": color.surfaceControlHover,
		},
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		display: "flex",
		height: controlSize._7,
		justifyContent: "center",
		width: controlSize._7,
	},
	flowList: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		gap: controlSize._2,
		overflowY: "auto",
		padding: controlSize._3,
	},
	flowCard: {
		backgroundColor: {
			default: color.surfaceTranslucent,
			":hover": color.surfaceControl,
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
		transitionProperty: "background-color, border-color, box-shadow",
		transitionTimingFunction: motion.ease,
	},
	flowCardSelected: {
		backgroundColor: color.controlActive,
		borderColor: color.borderStrong,
		boxShadow: shadow.selectedRing,
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
	smallButton: {
		backgroundColor: {
			default: color.surfaceControl,
			":hover": color.surfaceControlHover,
		},
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		fontSize: font.size_1,
		height: controlSize._6,
		paddingInline: controlSize._2,
	},
	primaryButton: {
		backgroundColor: {
			default: color.textMain,
			":hover": color.textSoft,
		},
		borderRadius: radius.md,
		color: color.background,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		height: controlSize._6,
		paddingInline: controlSize._3,
	},
	canvas: {
		backgroundColor: color.transparent,
		flex: 1,
		minHeight: 0,
		overflow: "auto",
		position: "relative",
	},
	canvasGrid: {
		backgroundImage:
			"radial-gradient(circle at 1px 1px, rgba(255,255,255,0.055) 1px, transparent 0)",
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
			default: "rgba(255,255,255,0.08)",
			":hover": "rgba(255,255,255,0.14)",
		},
		borderColor: "rgba(255,255,255,0.15)",
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textMain,
		display: "flex",
		height: controlSize._8,
		justifyContent: "center",
		width: controlSize._8,
	},
	addMenu: {
		backdropFilter: "blur(16px)",
		backgroundColor: "rgba(12, 12, 14, 0.95)",
		borderColor: "rgba(255,255,255,0.1)",
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
			":hover": "rgba(255,255,255,0.06)",
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
		borderRadius: radius.sm,
		display: "flex",
		flexShrink: 0,
		height: controlSize._6,
		justifyContent: "center",
		width: controlSize._6,
	},
	menuIconemerald: { backgroundColor: "rgba(16, 185, 129, 0.8)" },
	menuIconblue: { backgroundColor: "rgba(59, 130, 246, 0.8)" },
	menuIconpurple: { backgroundColor: "rgba(168, 85, 247, 0.8)" },
	menuIconamber: { backgroundColor: "rgba(245, 158, 11, 0.8)" },
	menuIconcyan: { backgroundColor: "rgba(6, 182, 212, 0.8)" },
	menuIconpink: { backgroundColor: "rgba(236, 72, 153, 0.8)" },
	menuIconorange: { backgroundColor: "rgba(249, 115, 22, 0.8)" },
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
			default: "rgba(12, 12, 14, 0.94)",
			":hover": "rgba(18, 18, 20, 0.96)",
		},
		borderColor: color.border,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.popover,
		cursor: "grab",
		display: "flex",
		flexDirection: "column",
		minHeight: 78,
		padding: 0,
		position: "absolute",
		textAlign: "left",
		touchAction: "none",
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, border-color, transform",
		transitionTimingFunction: motion.ease,
		userSelect: "none",
		width: NODE_WIDTH,
	},
	nodeToneemerald: {
		backgroundColor:
			"color-mix(in srgb, var(--color-inferay-success) 5%, #050505)",
		borderColor: "rgba(16, 185, 129, 0.4)",
	},
	nodeToneblue: {
		backgroundColor: "color-mix(in srgb, #3b82f6 7%, #050505)",
		borderColor: "rgba(59, 130, 246, 0.4)",
	},
	nodeTonepurple: {
		backgroundColor: "color-mix(in srgb, #a855f7 8%, #050505)",
		borderColor: "rgba(168, 85, 247, 0.4)",
	},
	nodeTonepink: {
		backgroundColor: "color-mix(in srgb, #ec4899 8%, #050505)",
		borderColor: "rgba(236, 72, 153, 0.4)",
	},
	nodeToneamber: {
		backgroundColor: "color-mix(in srgb, #f59e0b 7%, #050505)",
		borderColor: "rgba(245, 158, 11, 0.4)",
	},
	nodeToneorange: {
		backgroundColor: "color-mix(in srgb, #f97316 7%, #050505)",
		borderColor: "rgba(249, 115, 22, 0.4)",
	},
	nodeTonecyan: {
		backgroundColor: "color-mix(in srgb, #06b6d4 7%, #050505)",
		borderColor: "rgba(6, 182, 212, 0.4)",
	},
	nodeCardSelected: {
		borderColor: color.focusRing,
		boxShadow: shadow.focusRing,
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
		borderRadius: radius.sm,
		color: color.textMain,
		display: "flex",
		flexShrink: 0,
		height: controlSize._4,
		justifyContent: "center",
		width: controlSize._4,
	},
	nodeIconemerald: { backgroundColor: "rgba(16, 185, 129, 0.8)" },
	nodeIconblue: { backgroundColor: "#3b82f6" },
	nodeIconpurple: { backgroundColor: "#a855f7" },
	nodeIconpink: { backgroundColor: "#ec4899" },
	nodeIconamber: { backgroundColor: "#f59e0b" },
	nodeIconorange: { backgroundColor: "#f97316" },
	nodeIconcyan: { backgroundColor: "#06b6d4" },
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
		backgroundColor: color.surfaceInset,
		borderColor: color.borderSubtle,
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
		backgroundColor: color.surfaceInset,
		borderColor: color.borderSubtle,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		lineHeight: 1.5,
		maxHeight: 200,
		overflow: "auto",
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
