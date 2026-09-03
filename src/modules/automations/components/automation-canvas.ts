import type { AutomationNode } from "../model/automation-state.ts";
import { getNodeConfig } from "./automation-node-catalog.ts";

const NODE_WIDTH = 200;
const NODE_PORT_TOP = 44;
const NODE_PORT_ROW_HEIGHT = 16;

export function getInputPortY(node: AutomationNode): number {
	return node.y + NODE_PORT_TOP;
}

export function getOutputPortY(node: AutomationNode): number {
	return (
		node.y +
		NODE_PORT_TOP +
		getNodeConfig(node.kind).inputs.length * NODE_PORT_ROW_HEIGHT
	);
}

export interface AutomationEdgeLine {
	fromId: string;
	toId: string;
	fromNode: AutomationNode;
	toNode: AutomationNode;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export function buildEdgePath(
	edge: AutomationEdgeLine,
	override?: { nodeId: string; x: number; y: number },
) {
	const x1 =
		override?.nodeId === edge.fromId ? override.x + NODE_WIDTH : edge.x1;
	const y1 =
		override?.nodeId === edge.fromId
			? getOutputPortY({ ...edge.fromNode, x: override.x, y: override.y })
			: edge.y1;
	const x2 = override?.nodeId === edge.toId ? override.x : edge.x2;
	const y2 =
		override?.nodeId === edge.toId
			? getInputPortY({ ...edge.toNode, x: override.x, y: override.y })
			: edge.y2;
	return `M ${x1} ${y1} C ${x1 + 80} ${y1}, ${x2 - 80} ${y2}, ${x2} ${y2}`;
}

export function cleanupAutomationDrag({
	dragFrameRef,
	dragCleanupRef,
}: {
	dragFrameRef: { current: number | null };
	dragCleanupRef: { current: (() => void) | null };
}) {
	if (dragFrameRef.current !== null)
		window.cancelAnimationFrame(dragFrameRef.current);
	dragCleanupRef.current?.();
}
