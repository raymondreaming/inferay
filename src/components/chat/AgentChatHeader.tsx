import { getAgentIcon } from "../../lib/agent-ui.tsx";
import { getAgentDefinition } from "../../lib/agents.ts";
import { DropdownButton } from "../ui/DropdownButton.tsx";
import { IconGitBranch, IconX } from "../ui/Icons.tsx";
import type { AgentChatSession } from "./agent-chat-shared.ts";

interface AgentChatHeaderProps {
	paneId: string;
	cwd?: string;
	gitBranch: string | null;
	draggable?: boolean;
	onDragStart?: (e: React.DragEvent) => void;
	onDragEnd?: () => void;
	onClose?: (paneId: string) => void;
	sessions?: AgentChatSession[];
	onSelectSession?: (paneId: string) => void;
}

export function AgentChatHeader({
	paneId,
	cwd,
	gitBranch,
	draggable,
	onDragStart,
	onDragEnd,
	onClose,
	sessions,
	onSelectSession,
}: AgentChatHeaderProps) {
	const dirName = cwd ? cwd.split("/").pop() || cwd : null;
	const hasMultipleSessions =
		sessions && sessions.length > 1 && onSelectSession;
	const sessionOptions = hasMultipleSessions
		? sessions.map((session) => ({
				id: session.paneId,
				label:
					(session.cwd ?? "").split("/").pop() || session.cwd || "No directory",
				detail: getAgentDefinition(session.agentKind).label,
				icon: getAgentIcon(session.agentKind, 12),
			}))
		: [];

	return (
		<div
			className={`electrobun-webkit-app-region-no-drag shrink-0 flex items-center gap-1.5 px-3 py-1.5 border-b border-inferay-gray-border ${draggable ? "cursor-grab active:cursor-grabbing" : ""} select-none`}
			draggable={draggable}
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
		>
			{dirName && (
				<>
					{hasMultipleSessions ? (
						<span className="electrobun-webkit-app-region-no-drag">
							<DropdownButton
								value={paneId}
								options={sessionOptions}
								onChange={onSelectSession}
								minWidth={220}
								buttonClassName="h-4 rounded-md border-transparent px-1.5 text-[9px] font-medium hover:bg-inferay-white/[0.06]"
								labelClassName="max-w-[120px] truncate text-[9px]"
							/>
						</span>
					) : (
						<span
							className="text-[9px] font-medium text-inferay-white truncate"
							title={cwd}
						>
							{dirName}
						</span>
					)}
				</>
			)}
			{gitBranch && (
				<>
					<span className="text-[9px] text-inferay-muted-gray">›</span>
					<IconGitBranch
						size={9}
						className="text-inferay-muted-gray shrink-0"
					/>
					<span
						className="text-[9px] font-medium text-inferay-white truncate max-w-[80px]"
						title={gitBranch}
					>
						{gitBranch}
					</span>
				</>
			)}
			<span className="flex-1" />
			{onClose && (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						onClose(paneId);
					}}
					className="electrobun-webkit-app-region-no-drag flex items-center justify-center h-4 w-4 rounded transition-colors text-inferay-muted-gray hover:text-red-400 hover:bg-red-500/15"
					title="Close"
				>
					<IconX size={8} />
				</button>
			)}
		</div>
	);
}
