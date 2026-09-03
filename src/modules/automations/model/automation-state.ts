export type AutomationStatus = "ready" | "scheduled" | "running";
export type NodeKind =
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

export interface AutomationNode {
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

export interface AutomationFlow {
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

export interface NodeDragState {
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

export interface RunState {
	flowId: string;
	activeNodeId: string | null;
	completedNodeIds: string[];
	failedNodeId: string | null;
	isRunning: boolean;
	nodeOutputs: Record<string, string>;
}

export interface AutomationsState {
	selectedFlowId: string;
	selectedNodeId: string;
	showGrid: boolean;
	showAddMenu: boolean;
	dragState: NodeDragState | null;
	runState: RunState | null;
}

export type AutomationsAction =
	| { type: "flowSelected"; flowId: string; nodeId: string }
	| { type: "nodeSelected"; nodeId: string }
	| { type: "showGridChanged"; value: boolean }
	| { type: "showAddMenuChanged"; value: boolean }
	| { type: "dragStateChanged"; value: NodeDragState | null }
	| { type: "runStateChanged"; value: RunState | null };

export function createAutomationsState(flow: AutomationFlow): AutomationsState {
	return {
		selectedFlowId: flow.id,
		selectedNodeId: flow.nodes[0]?.id ?? "",
		showGrid: false,
		showAddMenu: false,
		dragState: null,
		runState: null,
	};
}

export function automationsReducer(
	state: AutomationsState,
	action: AutomationsAction,
): AutomationsState {
	switch (action.type) {
		case "flowSelected":
			return state.selectedFlowId === action.flowId &&
				state.selectedNodeId === action.nodeId
				? state
				: {
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
