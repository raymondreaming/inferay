import * as stylex from "@octanejs/stylex";
import { memo } from "octane";
import {
	iconSize,
	runtimeColor,
	surfaceStyles,
} from "../../../../design-system/styles.stylex.ts";
import { BorderBeamOverlay } from "../../../../shared/ui/BorderBeamOverlay/index.tsx";
import { Liquid } from "../../../../shared/ui/gooey/index.ts";
import { IconButton } from "../../../../shared/ui/IconButton/index.tsx";
import {
	IconAlertTriangle,
	IconMic,
	IconPlus,
	IconStop,
} from "../../../../shared/ui/Icons/index.tsx";
import { CommandMenu } from "./CommandMenu.tsx";
import { ComposerAttachments } from "./ComposerAttachments.tsx";
import { ComposerControls } from "./ComposerControls.tsx";
import { FileMenu } from "./FileMenu.tsx";
import { MarkdownPreviewDialog } from "./MarkdownPreviewDialog.tsx";
import { ProviderConfigMenu } from "./ProviderConfigMenu.tsx";
import { QueuedMessages } from "./QueuedMessages.tsx";
import * as inlineStyles from "./styles.ts";

import { styles } from "./styles.ts";
import { useChatComposerState } from "./useChatComposerState.tsx";

export const ChatComposer = memo(function ChatComposer(
	props: Parameters<typeof useChatComposerState>[0],
) {
	const {
		showInput,
		input,
		setInput,
		attachedImages,
		removeAttachedImage,
		attachImage,
		queuedMessages,
		editingQueueId,
		editingQueueText,
		setEditingQueueText,
		startQueuedMessageEdit,
		cancelQueuedMessageEdit,
		saveQueuedMessageEdit,
		removeQueuedMessage,
		fileMenu,
		setFileMenu,
		fileResults,
		selectFile,
		slashMenu,
		setSlashMenu,
		showCommands,
		filteredCommands,
		selectCommand,
		handleInputForFileMenu,
		handleInputForSlashMenu,
		handleKeyDown,
		handlePaste,
		textareaRef,
		highlightOverlayRef,
		inputContainerRef,
		mdPreview,
		setMdPreview,
		onMdFileClick,
		voiceInput,
		workspaceControl,
		beamActive,
		fileInputRef,
		agentConfigControlsRef,
		agentConfigButtonRef,
		agentConfigMenuRef,
		activeConfig,
		setActiveConfig,
		messageInputFocused,
		setMessageInputFocused,
		usePlainTextarea,
		inputHighlights,
		selectedModelLabel,
		configControls,
		activeControl,
	} = useChatComposerState(props);
	return (
		<>
			<input
				type="file"
				ref={fileInputRef}
				accept="image/*"
				multiple
				{...stylex.props(styles.hidden)}
				onChange={async (e) => {
					const files = Array.from(e.currentTarget.files || []).filter((file) =>
						file.type.startsWith("image/"),
					);
					await Promise.all(files.map((file) => attachImage(file)));
					e.currentTarget.value = "";
				}}
			/>

			{attachedImages.length > 0 && (
				<ComposerAttachments
					attachedImages={attachedImages}
					removeAttachedImage={removeAttachedImage}
				/>
			)}

			{showInput && (
				<div
					{...stylex.props(styles.inputDock)}
					className={`${stylex.props(styles.inputDock).className ?? ""} inferay-chat-composer`}
				>
					<Liquid
						blur={5}
						contrast={20}
						fill="transparent"
						filterPadding={18}
						shadow="none"
						className="inferay-message-liquid"
					>
						<Liquid.Item observe radius={12}>
							<div
								{...stylex.props(surfaceStyles.panel, styles.inputFrame)}
								ref={inputContainerRef}
							>
								<BorderBeamOverlay active={beamActive || messageInputFocused} />
								{fileMenu.show && fileResults.length > 0 && (
									<FileMenu
										fileMenu={fileMenu}
										fileResults={fileResults}
										selectFile={selectFile}
										setFileMenu={setFileMenu}
									/>
								)}
								{showCommands && (
									<CommandMenu
										filteredCommands={filteredCommands}
										slashMenu={slashMenu}
										selectCommand={selectCommand}
										setSlashMenu={setSlashMenu}
									/>
								)}
								{queuedMessages.length > 0 && (
									<QueuedMessages
										queuedMessages={queuedMessages}
										editingQueueId={editingQueueId}
										editingQueueText={editingQueueText}
										setEditingQueueText={setEditingQueueText}
										startQueuedMessageEdit={startQueuedMessageEdit}
										cancelQueuedMessageEdit={cancelQueuedMessageEdit}
										saveQueuedMessageEdit={saveQueuedMessageEdit}
										removeQueuedMessage={removeQueuedMessage}
									/>
								)}

								<div {...stylex.props(styles.inputRow)}>
									<div {...stylex.props(styles.inputActions)}>
										<IconButton
											type="button"
											onClick={() => fileInputRef.current?.click()}
											variant="ghost"
											size="md"
											className={stylex.props(styles.noShrink).className}
											title="Attach image"
										>
											<IconPlus size={iconSize.xl} />
										</IconButton>
										{voiceInput && (
											<IconButton
												type="button"
												onClick={voiceInput.onToggleListening}
												variant="ghost"
												size="md"
												className={
													stylex.props(
														styles.noShrink,
														voiceInput.isListening &&
															styles.voiceButtonListening,
														!voiceInput.isListening && voiceInput.error
															? styles.voiceButtonError
															: null,
													).className
												}
												title={
													voiceInput.error && !voiceInput.isListening
														? voiceInput.error
														: voiceInput.isSupported
															? voiceInput.isListening
																? "Stop voice input"
																: "Start voice input"
															: "Voice input is not supported in this browser"
												}
												aria-label={
													voiceInput.isListening
														? "Stop voice input"
														: voiceInput.error
															? voiceInput.error
															: "Start voice input"
												}
												aria-pressed={voiceInput.isListening}
												disabled={!voiceInput.isSupported}
											>
												{voiceInput.isListening ? (
													<IconStop size={iconSize._2md} />
												) : voiceInput.error ? (
													<IconAlertTriangle size={iconSize._2lg} />
												) : (
													<IconMic size={iconSize.xl} />
												)}
											</IconButton>
										)}
									</div>

									<div
										{...stylex.props(styles.textAreaWrap)}
										style={inlineStyles.getChatComposerTextAreaWrapStyle()}
									>
										{!usePlainTextarea && (
											<div
												ref={highlightOverlayRef}
												{...stylex.props(styles.highlightOverlay)}
												style={inlineStyles.getChatComposerHighlightOverlayStyle()}
												aria-hidden="true"
											>
												{inputHighlights}
											</div>
										)}
										<textarea
											ref={textareaRef}
											value={input}
											onFocus={() => setMessageInputFocused(true)}
											onBlur={() => setMessageInputFocused(false)}
											onInput={(e) => {
												const val = e.currentTarget.value;
												setInput(val);
												const cursor =
													e.currentTarget.selectionStart ?? val.length;
												handleInputForFileMenu(val, cursor);
												handleInputForSlashMenu(val, cursor);
												if (highlightOverlayRef.current) {
													highlightOverlayRef.current.style.transform = `translateY(-${e.currentTarget.scrollTop}px)`;
												}
											}}
											onScroll={(e) => {
												if (highlightOverlayRef.current) {
													highlightOverlayRef.current.style.transform = `translateY(-${e.currentTarget.scrollTop}px)`;
												}
											}}
											onKeyDown={handleKeyDown}
											onPaste={handlePaste}
											placeholder="Message… (/ commands, @ files)"
											rows={1}
											aria-label="Message input"
											spellCheck
											autoCorrect="on"
											autoCapitalize="sentences"
											{...stylex.props(styles.textarea)}
											style={inlineStyles.getChatComposerTextareaStyle(
												usePlainTextarea
													? runtimeColor.textMain
													: "transparent",
												usePlainTextarea
													? runtimeColor.textMain
													: "transparent",
											)}
										/>
									</div>
								</div>
								<ComposerControls
									agentConfigControlsRef={agentConfigControlsRef}
									configControls={configControls}
									activeConfig={activeConfig}
									selectedModelLabel={selectedModelLabel}
									agentConfigButtonRef={agentConfigButtonRef}
									setActiveConfig={setActiveConfig}
									workspaceControl={workspaceControl}
								/>
							</div>
						</Liquid.Item>
					</Liquid>
				</div>
			)}

			{showInput && activeControl && (
				<ProviderConfigMenu
					agentConfigMenuRef={agentConfigMenuRef}
					activeControl={activeControl}
					setActiveConfig={setActiveConfig}
					agentConfigButtonRef={agentConfigButtonRef}
				/>
			)}

			{mdPreview.show && (
				<MarkdownPreviewDialog
					setMdPreview={setMdPreview}
					mdPreview={mdPreview}
					onMdFileClick={onMdFileClick}
				/>
			)}
		</>
	);
});
