import {
	IconAgent,
	IconEye,
	IconFilePlus,
	IconGlobe,
	IconRobot,
	IconWorkflow,
} from "../../../shared/ui/Icons.tsx";
import type { NodeKind } from "../model/automation-state.ts";

export interface NodeKindConfig {
	label: string;
	icon: typeof IconWorkflow;
	inputs: string[];
	outputs: string[];
	tone: "emerald" | "blue" | "purple" | "pink" | "amber" | "orange" | "cyan";
	hint: string;
	placeholder: string;
	autoDescription: string;
}

export const toolKinds: NodeKind[] = [
	"input",
	"web",
	"agent",
	"script",
	"note",
	"output",
];

const nodeKinds: Record<NodeKind, NodeKindConfig> = {
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

export function getNodeConfig(kind: unknown): NodeKindConfig {
	return typeof kind === "string" && kind in nodeKinds
		? nodeKinds[kind as NodeKind]
		: nodeKinds.note;
}
