import type { MouseEvent } from "react";
import { useState } from "react";
import { Icons } from "./Icons";
import { models } from "./data";

function stopPropagation(event: MouseEvent) {
	event.stopPropagation();
}

export function ClaudeAvatar({ size = "sm" }: { size?: "sm" | "md" | "lg" }) {
	const sizeClasses = {
		sm: "w-5 h-5 text-[8px]",
		md: "w-6 h-6 text-[9px]",
		lg: "w-7 h-7 text-[10px]",
	};
	return (
		<div
			className={`${sizeClasses[size]} rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shrink-0`}
		>
			<span className="font-bold text-white">C</span>
		</div>
	);
}

// Model Selector
export function ModelSelector({
	selectedModel,
	onSelect,
}: {
	selectedModel: string;
	onSelect: (id: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const current = models.find((m) => m.id === selectedModel) ?? models[0]!;

	return (
		<div className="relative">
			<button
				onClick={() => setOpen(!open)}
				className="flex items-center gap-1.5 h-5 px-1.5 rounded-md border border-inferay-border bg-inferay-surface hover:bg-inferay-surface-2 transition-colors"
			>
				<span
					className="w-1.5 h-1.5 rounded-full"
					style={{ backgroundColor: current.color }}
				/>
				<span className="text-[9px] font-medium text-inferay-text">
					{current.name}
				</span>
				<Icons.Chevron />
			</button>
			{open && (
				<div className="absolute top-full mt-1 left-0 w-36 rounded-md border border-inferay-border bg-inferay-surface shadow-xl z-50">
					{models.map((model) => (
						<button
							key={model.id}
							onClick={() => {
								onSelect(model.id);
								setOpen(false);
							}}
							className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-inferay-surface-2 first:rounded-t-md last:rounded-b-md ${model.id === selectedModel ? "bg-inferay-surface-2" : ""}`}
						>
							<span
								className="w-1.5 h-1.5 rounded-full"
								style={{ backgroundColor: model.color }}
							/>
							<span className="text-[9px] font-medium text-inferay-text">
								{model.name}
							</span>
							<span className="text-[8px] text-inferay-text-3 ml-auto">
								{model.provider}
							</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

export function CommandBar({ onClose }: { onClose: () => void }) {
	const [query, setQuery] = useState("");
	const commands = [
		{ icon: <Icons.File />, label: "Open file...", shortcut: "⌘P" },
		{ icon: <Icons.Search />, label: "Search in files", shortcut: "⌘⇧F" },
		{ icon: <Icons.Git />, label: "Git: Commit", shortcut: "⌘⇧G" },
		{ icon: <Icons.Split />, label: "Split editor", shortcut: "⌘\\" },
		{ icon: <Icons.Settings />, label: "Settings", shortcut: "⌘," },
	];

	return (
		<div
			className="absolute inset-0 z-50 flex items-start justify-center pt-20 bg-black/50 backdrop-blur-sm"
			onClick={onClose}
		>
			<div
				className="w-full max-w-lg rounded-xl border border-inferay-border bg-inferay-bg shadow-2xl overflow-hidden"
				onClick={stopPropagation}
			>
				<div className="flex items-center gap-3 px-4 py-3 border-b border-inferay-border">
					<Icons.Search />
					<input
						autoFocus
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Type a command or search..."
						className="flex-1 bg-transparent text-sm text-inferay-text outline-none placeholder:text-inferay-text-3"
					/>
					<kbd className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-inferay-surface border border-inferay-border text-inferay-text-3">
						ESC
					</kbd>
				</div>
				<div className="max-h-80 overflow-auto">
					{commands
						.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
						.map((cmd, i) => (
							<button
								key={i}
								className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-inferay-surface-2 transition-colors"
							>
								<span className="text-inferay-text-3">{cmd.icon}</span>
								<span className="flex-1 text-left text-[12px] text-inferay-text">
									{cmd.label}
								</span>
								<kbd className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-inferay-surface border border-inferay-border text-inferay-text-3">
									{cmd.shortcut}
								</kbd>
							</button>
						))}
				</div>
			</div>
		</div>
	);
}

// Thinking Indicator (AI processing)
export function ThinkingIndicator() {
	return (
		<div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-inferay-accent/10 border border-inferay-accent/20">
			<div className="flex gap-0.5">
				{[0, 1, 2].map((i) => (
					<div
						key={i}
						className="w-1 h-1 rounded-full bg-inferay-accent animate-bounce"
						style={{
							animationDuration: "0.6s",
							animationDelay: `${i * 0.1}s`,
						}}
					/>
				))}
			</div>
			<span className="text-[10px] text-inferay-accent font-medium">
				Editing file...
			</span>
		</div>
	);
}

// Minimap
export function Minimap() {
	return (
		<div className="w-20 shrink-0 bg-inferay-bg/50 border-l border-inferay-border overflow-hidden">
			<div className="h-full relative">
				{[...Array(40)].map((_, i) => (
					<div
						key={i}
						className="h-[3px] my-[1px] mx-2 rounded-full"
						style={{
							width: `${30 + Math.random() * 50}%`,
							backgroundColor:
								i === 16 || i === 17 || i === 18 || i === 19
									? "rgba(46,160,67,0.3)"
									: "rgba(255,255,255,0.06)",
						}}
					/>
				))}
				<div className="absolute top-2 left-0 right-0 h-16 border border-inferay-accent/30 bg-inferay-accent/5 rounded" />
			</div>
		</div>
	);
}
