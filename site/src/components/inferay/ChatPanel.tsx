import { useState } from "react";
import { Icons } from "./Icons";
import { InlineDiffBlock } from "./DiffViewer";
import { inlineDiffLines } from "./data";

type ChatMessage =
	| { role: "user"; content: string }
	| { role: "assistant"; content: string }
	| {
			role: "tool";
			name: "Edit" | "Bash" | "Read";
			content: string;
			file?: string;
			inlineDiff?: boolean;
	  };

type ChatThread = {
	id: string;
	title: string;
	folder: string;
	agent: "Codex" | "Claude";
	model: string;
	reasoning?: string;
	status: "editing" | "reading" | "done";
	time: string;
	messages: ChatMessage[];
};

const threads: ChatThread[] = [
	{
		id: "repo-cleanup",
		title: "Align site demo",
		folder: "inferay",
		agent: "Codex",
		model: "GPT-5.5",
		reasoning: "Low",
		status: "editing",
		time: "0:42",
		messages: [
			{
				role: "user",
				content:
					"Make the site mock match the current app. Start with the chat grid, composer, and inline diff cards.",
			},
			{
				role: "assistant",
				content:
					"I found the old marketing mock was still showing the legacy sidebar and a simplified input. I’m lining it up with the current shell and grid layout.",
			},
			{
				role: "tool",
				name: "Edit",
				file: "site/src/components/Inferay.tsx",
				content: "Updated the shell, sidebar, header tabs, and chat grid.",
				inlineDiff: true,
			},
		],
	},
	{
		id: "app-files",
		title: "Files workflow",
		folder: "inferay",
		agent: "Claude",
		model: "Opus 4.7",
		status: "reading",
		time: "0:18",
		messages: [
			{
				role: "user",
				content:
					"Can I select a few screenshots and start a chat with them from Files?",
			},
			{
				role: "assistant",
				content:
					"Yes. Files keeps selection local, then opens the active chat with those file paths queued as context.",
			},
			{
				role: "tool",
				name: "Read",
				file: "src/pages/ImagesPage/index.tsx",
				content:
					"Loaded file table, selection, delete, and start-chat behavior.",
			},
		],
	},
	{
		id: "release",
		title: "Release check",
		folder: "site",
		agent: "Codex",
		model: "GPT-5.4",
		reasoning: "Medium",
		status: "done",
		time: "done",
		messages: [
			{
				role: "user",
				content: "Why did Vercel fail on shiki?",
			},
			{
				role: "assistant",
				content:
					"The site imported a desktop hook. I removed the cross-import so the static build owns its own demo rendering.",
			},
			{
				role: "tool",
				name: "Bash",
				content: "bun run build\n[build] Complete!",
			},
		],
	},
];

function AgentBadge({
	agent,
	model,
	reasoning,
}: {
	agent: ChatThread["agent"];
	model: string;
	reasoning?: string;
}) {
	return (
		<div className="flex items-center gap-1.5 min-w-0">
			<span
				className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[9px] font-semibold ${
					agent === "Codex"
						? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
						: "border-amber-400/20 bg-amber-400/10 text-amber-200"
				}`}
			>
				{agent === "Codex" ? "C" : "A"}
			</span>
			<div className="min-w-0">
				<div className="truncate text-[10px] font-semibold text-inferay-text">
					{agent}
				</div>
				<div className="truncate text-[8px] text-inferay-text-3">
					{model}
					{reasoning ? ` · ${reasoning}` : ""}
				</div>
			</div>
		</div>
	);
}

function StatusPill({ status }: { status: ChatThread["status"] }) {
	const info =
		status === "editing"
			? { icon: <Icons.Edit />, label: "Editing", color: "text-amber-300" }
			: status === "reading"
				? { icon: <Icons.Eye />, label: "Reading", color: "text-sky-300" }
				: {
						icon: <Icons.Check />,
						label: "Done",
						color: "text-inferay-text-3",
					};
	return (
		<span className="inline-flex h-5 items-center gap-1 rounded-md border border-inferay-border bg-inferay-surface px-1.5 text-[8px] text-inferay-text-2">
			<span className={info.color}>{info.icon}</span>
			{info.label}
		</span>
	);
}

function ToolCard({
	message,
}: {
	message: Extract<ChatMessage, { role: "tool" }>;
}) {
	return (
		<div className="overflow-hidden rounded-md border border-inferay-border bg-inferay-surface">
			<div className="flex min-h-6 items-center gap-1.5 border-b border-inferay-border bg-inferay-bg px-2">
				<span className="rotate-90 text-inferay-text-3">
					<Icons.Chevron />
				</span>
				<span className="text-inferay-text-3">
					{message.name === "Bash" ? (
						<Icons.Bash />
					) : message.name === "Read" ? (
						<Icons.Eye />
					) : (
						<Icons.FilePlus />
					)}
				</span>
				<span className="min-w-0 flex-1 truncate font-mono text-[8px] text-inferay-text-2">
					{message.file ?? message.name}
				</span>
				{message.inlineDiff && (
					<span className="flex shrink-0 items-center gap-1 font-mono text-[8px]">
						<span className="text-green-400">+6</span>
						<span className="text-red-400">-2</span>
					</span>
				)}
			</div>
			{message.inlineDiff ? (
				<InlineDiffBlock
					lines={inlineDiffLines}
					filePath={message.file ?? ""}
				/>
			) : (
				<pre className="max-h-20 overflow-auto whitespace-pre-wrap px-2 py-1.5 font-mono text-[8px] leading-relaxed text-inferay-text-3">
					{message.content}
				</pre>
			)}
		</div>
	);
}

function MessageList({ messages }: { messages: ChatMessage[] }) {
	return (
		<div className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">
			{messages.map((message, index) => {
				if (message.role === "user") {
					return (
						<div key={index} className="flex justify-end">
							<div className="max-w-[86%] rounded-lg rounded-br-sm px-2.5 py-1.5 text-[10px] leading-relaxed text-inferay-text">
								{message.content}
							</div>
						</div>
					);
				}
				if (message.role === "tool") {
					return <ToolCard key={index} message={message} />;
				}
				return (
					<div
						key={index}
						className="text-[10px] leading-relaxed text-inferay-text-2"
					>
						{message.content}
					</div>
				);
			})}
		</div>
	);
}

function Composer({ compact = false }: { compact?: boolean }) {
	const [input, setInput] = useState("");
	return (
		<div className="shrink-0 px-2 pb-2">
			<div className="overflow-hidden rounded-lg border border-inferay-border bg-inferay-surface shadow-[0_10px_30px_rgba(0,0,0,0.22)]">
				<div className="flex items-start gap-1.5 px-1.5 py-1.5">
					<button
						type="button"
						className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-inferay-text-3 hover:bg-inferay-surface-2 hover:text-inferay-text"
						title="Attach file"
					>
						<Icons.Plus />
					</button>
					<textarea
						value={input}
						onChange={(event) => setInput(event.target.value)}
						placeholder="Message... (/ commands, @ files)"
						rows={compact ? 1 : 2}
						className="min-h-7 flex-1 resize-none bg-transparent py-1 text-[10px] leading-5 text-inferay-text outline-none placeholder:text-inferay-text-3"
					/>
					<button
						type="button"
						className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-inferay-text-3 hover:bg-inferay-surface-2 hover:text-inferay-text"
						title="Send"
					>
						<Icons.Send />
					</button>
				</div>
				<div className="flex items-center gap-1 border-t border-inferay-border px-1.5 py-1">
					<button className="h-5 rounded-md border border-inferay-border bg-inferay-bg px-2 text-[8px] font-medium text-inferay-text">
						Codex
					</button>
					<button className="h-5 rounded-md border border-inferay-border bg-inferay-bg px-2 text-[8px] text-inferay-text-2">
						GPT-5.5
					</button>
					<button className="h-5 rounded-md border border-inferay-border bg-inferay-bg px-2 text-[8px] text-inferay-text-2">
						Low
					</button>
					<span className="flex-1" />
					<span className="font-mono text-[8px] text-inferay-text-3">
						↵ send
					</span>
				</div>
			</div>
		</div>
	);
}

function ChatColumn({
	thread,
	active,
	onSelect,
}: {
	thread: ChatThread;
	active: boolean;
	onSelect: () => void;
}) {
	return (
		<section
			onClick={onSelect}
			className={`flex min-w-[260px] flex-1 flex-col border-r border-inferay-border last:border-r-0 ${
				active ? "bg-inferay-bg" : "bg-inferay-bg/70"
			}`}
		>
			<header className="flex h-11 shrink-0 items-center gap-2 border-b border-inferay-border px-2">
				<AgentBadge
					agent={thread.agent}
					model={thread.model}
					reasoning={thread.reasoning}
				/>
				<span className="min-w-0 flex-1" />
				<div className="hidden min-w-0 items-center gap-1 text-inferay-text-3 lg:flex">
					<Icons.Folder />
					<span className="max-w-20 truncate font-mono text-[8px]">
						{thread.folder}
					</span>
				</div>
			</header>
			<div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-inferay-border px-2">
				<StatusPill status={thread.status} />
				<span className="min-w-0 flex-1 truncate text-[9px] font-medium text-inferay-text-2">
					{thread.title}
				</span>
				<span className="font-mono text-[8px] tabular-nums text-inferay-text-3">
					{thread.time}
				</span>
				{thread.status !== "done" && (
					<button className="flex h-5 w-5 items-center justify-center rounded border border-inferay-border bg-inferay-surface text-inferay-text-3">
						<Icons.Pause />
					</button>
				)}
			</div>
			<MessageList messages={thread.messages} />
			<Composer compact />
		</section>
	);
}

export function ChatPanel() {
	return (
		<div className="flex h-full min-w-0 flex-col bg-inferay-bg">
			<header className="flex h-10 shrink-0 items-center gap-2 border-b border-inferay-border px-2">
				<AgentBadge agent="Codex" model="GPT-5.5" reasoning="Low" />
				<span className="flex-1" />
				<div className="flex items-center gap-1 text-inferay-text-3">
					<Icons.Folder />
					<span className="max-w-[120px] truncate font-mono text-[8px]">
						~/Developer/inferay
					</span>
				</div>
			</header>
			<MessageList messages={threads[0]!.messages} />
			<Composer />
		</div>
	);
}

export function ChatGridView() {
	const [activeChat, setActiveChat] = useState(0);
	return (
		<div className="flex min-h-0 flex-1 overflow-hidden bg-inferay-bg">
			{threads.map((thread, index) => (
				<ChatColumn
					key={thread.id}
					thread={thread}
					active={activeChat === index}
					onSelect={() => setActiveChat(index)}
				/>
			))}
		</div>
	);
}
