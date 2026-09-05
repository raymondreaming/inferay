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
	const view = useChatComposerState(props);
	return (
		<>
			<input
				type="file"
				ref={view.fileInputRef}
				accept="image/*"
				multiple
				{...stylex.props(styles.hidden)}
				onChange={async (e) => {
					const files = Array.from(e.currentTarget.files || []).filter((file) =>
						file.type.startsWith("image/"),
					);
					await Promise.all(files.map((file) => view.attachImage(file)));
					e.currentTarget.value = "";
				}}
			/>

			{view.attachedImages.length > 0 && <ComposerAttachments {...view} />}

			{
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
							<div {...stylex.props(surfaceStyles.panel, styles.inputFrame)}>
								<BorderBeamOverlay
									active={view.beamActive || view.messageInputFocused}
								/>
								{view.fileMenu.show && view.fileResults.length > 0 && (
									<FileMenu {...view} />
								)}
								{view.showCommands && <CommandMenu {...view} />}
								{view.queuedMessages.length > 0 && <QueuedMessages {...view} />}

								<div {...stylex.props(styles.inputRow)}>
									<div {...stylex.props(styles.inputActions)}>
										<IconButton
											type="button"
											onClick={() => view.fileInputRef.current?.click()}
											variant="ghost"
											size="md"
											className={stylex.props(styles.noShrink).className}
											title="Attach image"
										>
											<IconPlus size={iconSize.xl} />
										</IconButton>
										{view.voiceInput && (
											<IconButton
												type="button"
												onClick={view.voiceInput.onToggleListening}
												variant="ghost"
												size="md"
												className={
													stylex.props(
														styles.noShrink,
														view.voiceInput.isListening &&
															styles.voiceButtonListening,
														!view.voiceInput.isListening &&
															view.voiceInput.error
															? styles.voiceButtonError
															: null,
													).className
												}
												title={
													view.voiceInput.error && !view.voiceInput.isListening
														? view.voiceInput.error
														: view.voiceInput.isSupported
															? view.voiceInput.isListening
																? "Stop voice input"
																: "Start voice input"
															: "Voice input is not supported in this browser"
												}
												aria-label={
													view.voiceInput.isListening
														? "Stop voice input"
														: view.voiceInput.error
															? view.voiceInput.error
															: "Start voice input"
												}
												aria-pressed={view.voiceInput.isListening}
												disabled={!view.voiceInput.isSupported}
											>
												{view.voiceInput.isListening ? (
													<IconStop size={iconSize._2md} />
												) : view.voiceInput.error ? (
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
										{!view.usePlainTextarea && (
											<div
												ref={view.highlightOverlayRef}
												{...stylex.props(styles.highlightOverlay)}
												style={inlineStyles.getChatComposerHighlightOverlayStyle()}
												aria-hidden="true"
											>
												{view.inputHighlights}
											</div>
										)}
										<textarea
											ref={view.textareaRef}
											value={view.input}
											onFocus={() => view.setMessageInputFocused(true)}
											onBlur={() => view.setMessageInputFocused(false)}
											onInput={(e) => {
												const val = e.currentTarget.value;
												view.setInput(val);
												const cursor =
													e.currentTarget.selectionStart ?? val.length;
												view.handleInputForFileMenu(val, cursor);
												view.handleInputForSlashMenu(val, cursor);
												if (view.highlightOverlayRef.current) {
													view.highlightOverlayRef.current.style.transform = `translateY(-${e.currentTarget.scrollTop}px)`;
												}
											}}
											onScroll={(e) => {
												if (view.highlightOverlayRef.current) {
													view.highlightOverlayRef.current.style.transform = `translateY(-${e.currentTarget.scrollTop}px)`;
												}
											}}
											onKeyDown={view.handleKeyDown}
											onPaste={view.handlePaste}
											placeholder="Message… (/ commands, @ files)"
											rows={1}
											aria-label="Message input"
											spellCheck
											autoCorrect="on"
											autoCapitalize="sentences"
											{...stylex.props(styles.textarea)}
											style={inlineStyles.getChatComposerTextareaStyle(
												view.usePlainTextarea
													? runtimeColor.textMain
													: "transparent",
												view.usePlainTextarea
													? runtimeColor.textMain
													: "transparent",
											)}
										/>
									</div>
								</div>
								<ComposerControls {...view} />
							</div>
						</Liquid.Item>
					</Liquid>
				</div>
			}

			{view.activeControl && (
				<ProviderConfigMenu {...view} activeControl={view.activeControl} />
			)}

			{view.mdPreview.show && <MarkdownPreviewDialog {...view} />}
		</>
	);
});
