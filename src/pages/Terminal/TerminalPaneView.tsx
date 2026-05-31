import * as stylex from "@stylexjs/stylex";
import type React from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { AgentChatHandle } from "../../components/chat/AgentChatView.tsx";
import { AgentChatView } from "../../components/chat/AgentChatView.tsx";
import { IconButton } from "../../components/ui/IconButton.tsx";
import {
	IconSend,
	IconSimulator,
	IconTerminal,
	IconX,
} from "../../components/ui/Icons.tsx";
import {
	getAgentDefinition,
	isChatAgentKind,
	loadDefaultChatSettings,
} from "../../features/agents/agents.ts";
import { dispatchComposerContextBlock } from "../../features/chat/composer-context.ts";
import type {
	AgentKind,
	TerminalPaneModel,
	TerminalTheme,
} from "../../features/terminal/terminal-utils.ts";
import { useXtermTerminal } from "../../hooks/useXtermTerminal.ts";
import {
	activateOnEnterOrSpace,
	focusRef,
	stopPropagationAndCall,
} from "../../lib/react-events.ts";
import { color, font } from "../../tokens.stylex.ts";
import { SimulatorPaneView } from "./SimulatorPaneView.tsx";

interface TerminalPaneViewProps {
	pane: TerminalPaneModel;
	isSelected: boolean;
	isHighlighted?: boolean;
	theme: TerminalTheme;
	fontSize: number;
	fontFamily: string;
	onSelect: (paneId: string) => void;
	onClose: (paneId: string, force?: boolean) => void;
	onDirectorySelect?: (
		paneId: string,
		path: string | null,
		referencePaths?: string[]
	) => void;
	onDirectoryCancel?: (paneId: string) => void;
	chatRef: (paneId: string, handle: AgentChatHandle | null) => void;
	onAgentStatusChange?: (paneId: string, status: string) => void;
	paneIndex?: number;
	onHeaderDragStart?: (e: React.DragEvent, index: number) => void;
	onHeaderDragEnd?: () => void;
	onAddPane?: (agentKind: AgentKind) => void;
	onSetPaneAgentKind?: (paneId: string, agentKind: AgentKind) => void;
}

const INTERACTIVE_PANE_FOCUS_SELECTOR = [
	"button",
	"a",
	"input",
	"textarea",
	"select",
	"summary",
	'[contenteditable="true"]',
	'[role="button"]',
	'[role="menuitem"]',
	'[role="option"]',
	"[data-pane-focus-skip]",
].join(",");

function isInteractivePaneClickTarget(target: EventTarget | null) {
	const targetElement =
		typeof Element !== "undefined" && target instanceof Element
			? target
			: typeof Node !== "undefined" && target instanceof Node
				? target.parentElement
				: null;

	return !!targetElement?.closest(INTERACTIVE_PANE_FOCUS_SELECTOR);
}

export const TerminalPaneView = memo(function TerminalPaneView({
	pane,
	isSelected,
	isHighlighted = false,
	theme,
	fontSize,
	fontFamily,
	onSelect,
	onClose,
	onDirectorySelect,
	chatRef,
	onAgentStatusChange,
	paneIndex,
	onHeaderDragStart,
	onHeaderDragEnd,
	onAddPane,
	onSetPaneAgentKind,
}: TerminalPaneViewProps) {
	const chatHandleRef = useRef<AgentChatHandle | null>(null);
	const [selectedTerminalText, setSelectedTerminalText] = useState("");
	const isSimulatorPane = pane.utilityPane === "simulator";
	const viewAgentKind: AgentKind =
		pane.pendingCwd && !isChatAgentKind(pane.agentKind)
			? "claude"
			: pane.agentKind;
	const isAgentChatPane = isChatAgentKind(viewAgentKind);
	const paneLabel = isSimulatorPane
		? "Simulator"
		: getAgentDefinition(viewAgentKind).label;
	const { containerRef, termRef, refit } = useXtermTerminal({
		enabled: !isSimulatorPane && !isAgentChatPane && !pane.pendingCwd,
		paneId: pane.id,
		agentKind: pane.agentKind,
		isClaude: pane.isClaude,
		cwd: pane.cwd,
		theme,
		fontSize,
		fontFamily,
		onSelectionChange: setSelectedTerminalText,
	});

	useEffect(() => {
		if (isSelected && !isSimulatorPane && !isAgentChatPane) {
			refit();
		}
	}, [isAgentChatPane, isSelected, isSimulatorPane, refit]);
	useEffect(() => {
		if (isSimulatorPane || isAgentChatPane) setSelectedTerminalText("");
	}, [isAgentChatPane, isSimulatorPane]);
	const sendTerminalSelectionToAgent = useCallback(() => {
		const content = selectedTerminalText.trim();
		if (!content) return;
		dispatchComposerContextBlock({
			source: "terminal",
			title: `Terminal output from ${new Date().toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
			})}`,
			subtitle: pane.cwd ?? pane.title,
			content,
		});
		setSelectedTerminalText("");
		termRef.current?.clearSelection();
	}, [pane.cwd, pane.title, selectedTerminalText, termRef]);
	const focusChatInput = useCallback(() => {
		if (!isAgentChatPane) return;
		const focusInput = () => chatHandleRef.current?.focusInput(true);
		if (typeof window === "undefined") {
			focusInput();
			return;
		}
		if (typeof window.requestAnimationFrame === "function") {
			window.requestAnimationFrame(focusInput);
			return;
		}
		window.setTimeout(focusInput, 0);
	}, [isAgentChatPane]);
	const handlePaneClick = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			onSelect(pane.id);
			if (!isAgentChatPane || isInteractivePaneClickTarget(event.target))
				return;
			focusChatInput();
		},
		[focusChatInput, isAgentChatPane, onSelect, pane.id]
	);

	return (
		<div
			onClick={handlePaneClick}
			onKeyDown={
				isAgentChatPane
					? undefined
					: (e) => {
							if (e.key === "Enter" || e.key === " ") onSelect(pane.id);
						}
			}
			tabIndex={isAgentChatPane ? undefined : 0}
			role={isAgentChatPane ? undefined : "button"}
			{...stylex.props(styles.root)}
			style={{
				...(isAgentChatPane ? {} : { backgroundColor: theme.bg }),
			}}
		>
			{(isSelected || isHighlighted) && (
				<div
					aria-hidden="true"
					{...stylex.props(
						styles.focusGlow,
						isHighlighted ? styles.focusGlowPreview : styles.focusGlowActive
					)}
				/>
			)}
			{!isAgentChatPane && (
				<div
					className={`electrobun-webkit-app-region-no-drag ${stylex.props(styles.header).className ?? ""}`}
					style={{
						borderColor: theme.separator,
						backgroundColor: theme.bg,
					}}
					draggable={paneIndex != null && !!onHeaderDragStart}
					onDragStart={(e) => {
						if (paneIndex != null && onHeaderDragStart) {
							e.dataTransfer.setData("text/plain", pane.id);
							const img = new Image();
							img.src =
								"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
							e.dataTransfer.setDragImage(img, 0, 0);
							onHeaderDragStart(e, paneIndex);
						}
					}}
					onDragEnd={onHeaderDragEnd}
				>
					<span
						{...stylex.props(
							styles.terminalIcon,
							isSelected && styles.activeAccent
						)}
					>
						{isSimulatorPane ? (
							<IconSimulator size={10} />
						) : (
							<IconTerminal size={10} />
						)}
					</span>
					<span
						{...stylex.props(
							styles.paneLabel,
							isSelected && styles.selectedLabel
						)}
					>
						{paneLabel}
					</span>
					{pane.cwd && (
						<>
							<span {...stylex.props(styles.breadcrumbSep)}>›</span>
							<span
								{...stylex.props(
									styles.cwdLabel,
									isSelected && styles.selectedCwd
								)}
								title={pane.cwd}
							>
								{pane.cwd.split("/").pop() || pane.cwd}
							</span>
						</>
					)}
					<span {...stylex.props(styles.spacer)} />
					{isSelected && <div {...stylex.props(styles.selectedDot)} />}
					<IconButton
						type="button"
						onClick={stopPropagationAndCall.bind(
							null,
							onClose.bind(null, pane.id)
						)}
						className="electrobun-webkit-app-region-no-drag"
						variant="danger"
						size="xs"
						title="Close pane"
					>
						<IconX size={8} />
					</IconButton>
				</div>
			)}
			<div
				ref={containerRef}
				{...stylex.props(styles.termContainer)}
				style={{
					display: isAgentChatPane || isSimulatorPane ? "none" : undefined,
					pointerEvents: isSelected ? "auto" : "none",
					overflow: "hidden",
					padding: 0,
				}}
				onClick={focusRef.bind(null, termRef)}
				onKeyDown={activateOnEnterOrSpace.bind(
					null,
					focusRef.bind(null, termRef)
				)}
				tabIndex={0}
				role="button"
			/>
			{!isSimulatorPane && !isAgentChatPane && selectedTerminalText.trim() && (
				<button
					type="button"
					onMouseDown={(event) => event.preventDefault()}
					onClick={(event) => {
						event.stopPropagation();
						sendTerminalSelectionToAgent();
					}}
					{...stylex.props(styles.sendSelectionButton)}
				>
					<IconSend size={11} />
					Send to Agent
				</button>
			)}
			{isSimulatorPane && (
				<div
					{...stylex.props(styles.utilityPane)}
					style={{ pointerEvents: isSelected ? "auto" : "none" }}
				>
					<SimulatorPaneView />
				</div>
			)}
			{isAgentChatPane && (
				<div
					{...stylex.props(styles.agentPane)}
					style={{ pointerEvents: isSelected ? "auto" : "none" }}
				>
					<AgentChatView
						paneId={pane.id}
						cwd={pane.cwd}
						referencePaths={pane.referencePaths}
						agentKind={viewAgentKind}
						onStatusChange={onAgentStatusChange}
						onClose={onClose}
						isSelected={isSelected}
						onDirectoryChange={(pid, cwd, refs) => {
							if (pane.pendingCwd && !isChatAgentKind(pane.agentKind)) {
								onSetPaneAgentKind?.(pid, loadDefaultChatSettings().agentKind);
							}
							onDirectorySelect?.(pid, cwd, refs);
						}}
						onAddPane={onAddPane}
						draggable={paneIndex != null && !!onHeaderDragStart}
						onDragStart={(e) => {
							if (paneIndex != null && onHeaderDragStart) {
								e.dataTransfer.setData("text/plain", pane.id);
								const img = new Image();
								img.src =
									"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
								e.dataTransfer.setDragImage(img, 0, 0);
								onHeaderDragStart(e, paneIndex);
							}
						}}
						onDragEnd={onHeaderDragEnd}
						ref={(handle) => {
							chatHandleRef.current = handle;
							chatRef(pane.id, handle);
						}}
					/>
				</div>
			)}
		</div>
	);
});

const styles = stylex.create({
	root: {
		position: "relative",
		display: "flex",
		height: "100%",
		minHeight: 0,
		minWidth: 0,
		flexDirection: "column",
		overflow: "hidden",
	},
	focusGlow: {
		inset: 0,
		pointerEvents: "none",
		position: "absolute",
		zIndex: 8,
	},
	focusGlowActive: {
		backgroundImage:
			"radial-gradient(circle at 0 0, color-mix(in srgb, var(--color-inferay-light-gray) 26%, transparent), transparent 9rem), radial-gradient(circle at 100% 0, color-mix(in srgb, var(--color-inferay-gray) 18%, transparent), transparent 8rem), radial-gradient(circle at 0 100%, color-mix(in srgb, var(--color-inferay-light-gray) 12%, transparent), transparent 8rem), radial-gradient(circle at 100% 100%, color-mix(in srgb, var(--color-inferay-gray) 10%, transparent), transparent 7rem)",
	},
	focusGlowPreview: {
		backgroundImage:
			"radial-gradient(circle at 0 0, color-mix(in srgb, var(--color-inferay-light-gray) 34%, transparent), transparent 9rem), radial-gradient(circle at 100% 0, color-mix(in srgb, var(--color-inferay-gray) 24%, transparent), transparent 8rem), radial-gradient(circle at 0 100%, color-mix(in srgb, var(--color-inferay-light-gray) 16%, transparent), transparent 8rem), radial-gradient(circle at 100% 100%, color-mix(in srgb, var(--color-inferay-gray) 14%, transparent), transparent 7rem)",
	},
	header: {
		display: "flex",
		flexShrink: 0,
		minWidth: 0,
		cursor: "grab",
		userSelect: "none",
		alignItems: "center",
		gap: "0.5rem",
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		paddingBlock: "0.375rem",
		paddingInline: "0.75rem",
		":active": {
			cursor: "grabbing",
		},
	},
	terminalIcon: {
		color: color.textMuted,
	},
	activeAccent: {
		color: "var(--color-inferay-accent)",
	},
	paneLabel: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
	},
	selectedLabel: {
		color: color.textSoft,
	},
	breadcrumbSep: {
		color: color.textMuted,
		fontSize: font.size_1,
	},
	cwdLabel: {
		minWidth: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
	},
	selectedCwd: {
		color: color.textMain,
	},
	spacer: {
		flex: 1,
	},
	selectedDot: {
		width: "0.375rem",
		height: "0.375rem",
		borderRadius: "999px",
		backgroundColor: "var(--color-inferay-accent)",
	},
	termContainer: {
		minHeight: 0,
		minWidth: 0,
		flex: 1,
	},
	agentPane: {
		display: "flex",
		minHeight: 0,
		minWidth: 0,
		flex: 1,
		flexDirection: "column",
		overflow: "hidden",
	},
	utilityPane: {
		display: "flex",
		minHeight: 0,
		minWidth: 0,
		flex: 1,
		flexDirection: "column",
		overflow: "hidden",
	},
	sendSelectionButton: {
		alignItems: "center",
		backdropFilter: "blur(10px)",
		backgroundColor: "rgba(15, 23, 42, 0.92)",
		borderColor: color.border,
		borderRadius: 8,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: "0 8px 18px rgba(0, 0, 0, 0.35)",
		color: color.textSoft,
		cursor: "pointer",
		display: "inline-flex",
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		gap: "0.35rem",
		paddingBlock: "0.35rem",
		paddingInline: "0.55rem",
		position: "absolute",
		right: "0.55rem",
		top: "2.45rem",
		zIndex: 6,
		":hover": {
			backgroundColor: color.backgroundRaised,
			color: color.accent,
		},
	},
});
