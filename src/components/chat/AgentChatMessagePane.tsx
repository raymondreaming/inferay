import * as stylex from "@stylexjs/stylex";
import type React from "react";
import type { ChatMessage } from "../../features/chat/agent-chat-shared.ts";
import { color, controlSize } from "../../tokens.stylex.ts";
import { InlineDirectoryPicker } from "../../pages/Terminal/InlineDirectoryPicker.tsx";
import { IconArrowDown } from "../ui/Icons.tsx";
import {
	ChatMessageList,
	type ChatVirtualizerControls,
} from "./ChatMessageList.tsx";

const APP_REGION_DRAG_CLASS = "electrobun-webkit-app-region-drag";
const APP_REGION_NO_DRAG_CLASS = "electrobun-webkit-app-region-no-drag";

interface AgentChatMessagePaneProps {
	messages: ChatMessage[];
	scrollElementRef: React.RefObject<HTMLDivElement | null>;
	onScroll: () => void;
	onVirtualizerReady: (controls: ChatVirtualizerControls | null) => void;
	expandedTools: Set<string>;
	toggleTool: (id: string) => void;
	isLoading: boolean;
	startTime: number | null;
	handleSendMessage: (text: string) => void;
	onMdFileClick: (path: string) => void;
	slashCommandNames: readonly string[];
	paneId: string;
	cwd: string | null;
	showDirectoryPicker: boolean;
	onDirectorySelect: (path: string) => void;
	onDirectorySelectionChange: (paths: string[]) => void;
	onDirectoryMultiSelect: (paths: string[]) => void;
	isAtBottom: boolean;
	onScrollToBottom: () => void;
	statusBar?: React.ReactNode;
}

export function AgentChatMessagePane({
	messages,
	scrollElementRef,
	onScroll,
	onVirtualizerReady,
	expandedTools,
	toggleTool,
	isLoading,
	startTime,
	handleSendMessage,
	onMdFileClick,
	slashCommandNames,
	paneId,
	cwd,
	showDirectoryPicker,
	onDirectorySelect,
	onDirectorySelectionChange,
	onDirectoryMultiSelect,
	isAtBottom,
	onScrollToBottom,
	statusBar,
}: AgentChatMessagePaneProps) {
	const messageRegionProps = stylex.props(styles.messageRegion);
	const scrollAreaProps = stylex.props(styles.scrollArea);
	const directoryPickerInnerProps = stylex.props(styles.directoryPickerInner);
	const scrollButtonProps = stylex.props(styles.scrollButton);
	const statusCenterProps = stylex.props(styles.statusCenter);

	return (
		<div
			{...messageRegionProps}
			className={`${APP_REGION_DRAG_CLASS} ${messageRegionProps.className ?? ""}`}
		>
			<div
				ref={scrollElementRef}
				{...scrollAreaProps}
				className={`${APP_REGION_DRAG_CLASS} ${scrollAreaProps.className ?? ""}`}
				onScroll={onScroll}
			>
				{showDirectoryPicker && (
					<div {...stylex.props(styles.directoryPickerWrap)}>
						<div
							{...directoryPickerInnerProps}
							className={`${APP_REGION_NO_DRAG_CLASS} ${directoryPickerInnerProps.className ?? ""}`}
						>
							<InlineDirectoryPicker
								onSelect={(path) => {
									if (path) onDirectorySelect(path);
								}}
								multiSelect
								showStartButton={false}
								onSelectionChange={onDirectorySelectionChange}
								onMultiSelect={onDirectoryMultiSelect}
							/>
						</div>
					</div>
				)}
				<ChatMessageList
					messages={messages}
					scrollElementRef={scrollElementRef}
					onVirtualizerReady={onVirtualizerReady}
					expandedTools={expandedTools}
					toggleTool={toggleTool}
					isLoading={isLoading}
					startTime={startTime}
					handleSendMessage={handleSendMessage}
					onMdFileClick={onMdFileClick}
					slashCommandNames={slashCommandNames}
					paneId={paneId}
					cwd={cwd}
				/>
			</div>
			{!isAtBottom && (
				<button
					type="button"
					onClick={onScrollToBottom}
					{...scrollButtonProps}
					className={`${APP_REGION_NO_DRAG_CLASS} ${scrollButtonProps.className ?? ""}`}
				>
					<IconArrowDown size={12} {...stylex.props(styles.scrollIcon)} />
				</button>
			)}
			{statusBar && (
				<div {...stylex.props(styles.statusLayer)}>
					<div {...stylex.props(styles.statusFade)} />
					<div
						{...statusCenterProps}
						className={`${APP_REGION_NO_DRAG_CLASS} ${statusCenterProps.className ?? ""}`}
					>
						{statusBar}
					</div>
				</div>
			)}
		</div>
	);
}

const styles = stylex.create({
	messageRegion: {
		display: "flex",
		gridRow: "1",
		flex: 1,
		flexDirection: "column",
		minHeight: 0,
		minWidth: 0,
		overflow: "hidden",
		position: "relative",
	},
	scrollArea: {
		flex: 1,
		height: "auto",
		minHeight: 0,
		minWidth: 0,
		overflowX: "hidden",
		overflowY: "auto",
		overscrollBehavior: "contain",
		scrollbarWidth: "none",
		"::-webkit-scrollbar": {
			display: "none",
		},
	},
	directoryPickerWrap: {
		bottom: 0,
		boxSizing: "border-box",
		left: 0,
		maxWidth: "100%",
		minWidth: 0,
		overflow: "hidden",
		paddingBottom: controlSize._2,
		paddingInline: controlSize._3,
		pointerEvents: "none",
		position: "absolute",
		right: 0,
		zIndex: 10,
	},
	directoryPickerInner: {
		boxSizing: "border-box",
		marginInline: "auto",
		maxWidth: "min(42rem, 100%)",
		minWidth: 0,
		pointerEvents: "auto",
		width: "100%",
	},
	scrollButton: {
		position: "absolute",
		zIndex: 10,
		right: controlSize._2,
		bottom: controlSize._2,
		display: "flex",
		width: controlSize._6,
		height: controlSize._6,
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: "999px",
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.controlHover,
		},
		boxShadow: "0 1px 2px rgba(0, 0, 0, 0.24)",
		transitionProperty: "background-color, opacity",
		transitionDuration: "120ms",
	},
	scrollIcon: {
		color: color.textSoft,
	},
	statusLayer: {
		left: 0,
		pointerEvents: "none",
		position: "absolute",
		right: 0,
		top: 0,
		zIndex: 20,
	},
	statusFade: {
		backgroundImage:
			"linear-gradient(to bottom, rgba(0, 0, 0, 0.42), rgba(0, 0, 0, 0.22) 45%, rgba(0, 0, 0, 0))",
		height: "4.5rem",
		left: 0,
		position: "absolute",
		right: 0,
		top: 0,
	},
	statusCenter: {
		alignItems: "center",
		display: "flex",
		justifyContent: "center",
		left: "50%",
		maxWidth: "calc(100% - 1rem)",
		pointerEvents: "auto",
		position: "absolute",
		top: controlSize._3,
		transform: "translateX(-50%)",
	},
});
