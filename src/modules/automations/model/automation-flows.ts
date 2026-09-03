import type { AutomationFlow, AutomationNode } from "./automation-state.ts";

function areStringArraysEqual(previous: string[], next: string[]) {
	return (
		previous.length === next.length &&
		previous.every((value, index) => value === next[index])
	);
}

function areNodesEqual(previous: AutomationNode[], next: AutomationNode[]) {
	return (
		previous.length === next.length &&
		previous.every((node, index) => {
			const candidate = next[index];
			return (
				candidate !== undefined &&
				node.id === candidate.id &&
				node.kind === candidate.kind &&
				node.title === candidate.title &&
				node.description === candidate.description &&
				node.x === candidate.x &&
				node.y === candidate.y &&
				node.file === candidate.file &&
				node.body === candidate.body &&
				node.output === candidate.output &&
				areStringArraysEqual(
					node.contextPaths ?? [],
					candidate.contextPaths ?? [],
				)
			);
		})
	);
}

function areEdgesEqual(
	previous: Array<[string, string]>,
	next: Array<[string, string]>,
) {
	return (
		previous.length === next.length &&
		previous.every(
			(edge, index) =>
				edge[0] === next[index]?.[0] && edge[1] === next[index]?.[1],
		)
	);
}

export function areAutomationFlowsEqual(
	previous: AutomationFlow[],
	next: AutomationFlow[],
) {
	return (
		previous.length === next.length &&
		previous.every((flow, index) => {
			const candidate = next[index];
			return (
				candidate !== undefined &&
				flow.id === candidate.id &&
				flow.name === candidate.name &&
				flow.description === candidate.description &&
				flow.schedule === candidate.schedule &&
				flow.nextRun === candidate.nextRun &&
				flow.status === candidate.status &&
				flow.primaryPath === candidate.primaryPath &&
				areStringArraysEqual(flow.referencePaths, candidate.referencePaths) &&
				areNodesEqual(flow.nodes, candidate.nodes) &&
				areEdgesEqual(flow.edges, candidate.edges)
			);
		})
	);
}

export function createSampleFlow(): AutomationFlow {
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
