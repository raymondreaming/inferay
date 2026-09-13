import * as stylex from "@stylexjs/stylex";
import { AgentWorkspaceControl } from "../AgentChatHeader/index.tsx";
import { AgentChatStatusBar } from "../AgentChatStatusBar/index.tsx";
import { ChatComposer } from "../ChatComposer/index.tsx";
import { styles } from "./styles.ts";
import type { AgentChatState } from "./useAgentChatState.tsx";
export function AgentChatComposer(props: {
	state: AgentChatState;
	imageDragActive: boolean;
	setConfigOpen: (open: boolean) => void;
	openContext: () => void;
}) {
	return (
		<div {...stylex.attrs(styles.composerRegion)}>
			{props.imageDragActive && (
				<div {...stylex.attrs(styles.imageDropCue)}>Drop image to attach</div>
			)}
			<div {...stylex.attrs(styles.composerContent)}>
				<AgentChatStatusBar
					active={props.state.visible()}
					isLoading={props.state.connection.chatUiState.isLoading}
					startTime={props.state.connection.chatUiState.startTime}
					onStop={props.state.stopGeneration}
				/>
				{props.state.settings.configurationError && (
					<div role="alert">{props.state.settings.configurationError}</div>
				)}
				{props.state.composer.queueError && (
					<div role="alert">{props.state.composer.queueError}</div>
				)}
				<ChatComposer
					active={props.state.visible()}
					{...props.state.composer}
					{...props.state.menus}
					beamActive={props.state.highlight.active()}
					agentKind={props.state.agentKind()}
					agentKindOptions={props.state.settings.agentKindOptions}
					model={props.state.settings.effectiveSelectedModel}
					reasoningLevel={props.state.settings.selectedReasoningLevel}
					onAgentKindChange={props.state.settings.handleAgentKindChange}
					onModelChange={props.state.settings.handleModelChange}
					onReasoningLevelChange={
						props.state.settings.handleReasoningLevelChange
					}
					onAgentConfigOpenChange={props.setConfigOpen}
					input={props.state.input()}
					setInput={props.state.setInput}
					handleKeyDown={props.state.inputActions.handleKeyDown}
					textareaRef={props.state.viewport.textareaRef}
					highlightOverlayRef={props.state.viewport.highlightOverlayRef}
					onMdFileClick={props.state.composer.handleMdFileClick}
					voiceInput={props.state.voiceInput}
					workspaceControl={
						<AgentWorkspaceControl
							cwd={props.state.workspace.visibleCwd}
							onAgentContext={() => props.openContext()}
							isAgentContextOpen={false}
						/>
					}
				/>
			</div>
		</div>
	);
}
