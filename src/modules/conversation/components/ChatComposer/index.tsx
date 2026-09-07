import * as stylex from "@stylexjs/stylex";
import { Show } from "solid-js";
import {
	iconSize,
	runtimeColor,
	surfaceStyles,
} from "../../../../design-system/styles.stylex.ts";
import { ariaValue, assignRef, domStyle } from "../../../../shared/lib/dom.tsx";
import { BorderBeamOverlay } from "../../../../shared/ui/BorderBeamOverlay/index.tsx";
import { GooeyRoot } from "../../../../shared/ui/gooey/Gooey/index.tsx";
import { LiquidItem } from "../../../../shared/ui/gooey/LiquidItem/index.tsx";
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
export const ChatComposer = function ChatComposer(
	props: ReturnType<Parameters<typeof useChatComposerState>[0]>,
) {
	const view = useChatComposerState(() => props);
	return (
		<>
			<input
				type="file"
				ref={(_element) => assignRef(view.fileInputRef, _element)}
				accept="image/*"
				multiple
				{...stylex.attrs(styles.hidden)}
				onInput={async (e) => {
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
					{...stylex.attrs(styles.inputDock)}
					class={`${stylex.attrs(styles.inputDock).class ?? ""} inferay-chat-composer`}
				>
					<GooeyRoot
						blur={5}
						contrast={20}
						fill="transparent"
						filterPadding={18}
						shadow="none"
						class="inferay-message-liquid"
					>
						<LiquidItem observe radius={12}>
							<div {...stylex.attrs(surfaceStyles.panel, styles.inputFrame)}>
								<BorderBeamOverlay
									active={view.beamActive || view.messageInputFocused}
								/>
								{view.fileMenu.show && view.fileResults.length > 0 && (
									<FileMenu {...view} />
								)}
								{view.showCommands && <CommandMenu {...view} />}
								{view.queuedMessages.length > 0 && <QueuedMessages {...view} />}

								<div {...stylex.attrs(styles.inputRow)}>
									<div {...stylex.attrs(styles.inputActions)}>
										<IconButton
											type="button"
											onClick={() => view.fileInputRef.current?.click()}
											variant="ghost"
											size="md"
											class={stylex.attrs(styles.noShrink).class}
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
												class={
													stylex.attrs(
														styles.noShrink,
														view.voiceInput.isListening &&
															styles.voiceButtonListening,
														!view.voiceInput.isListening &&
															view.voiceInput.error
															? styles.voiceButtonError
															: null,
													).class
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
												aria-label={ariaValue(
													view.voiceInput.isListening
														? "Stop voice input"
														: view.voiceInput.error
															? view.voiceInput.error
															: "Start voice input",
												)}
												aria-pressed={ariaValue(view.voiceInput.isListening)}
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
										{...stylex.attrs(styles.textAreaWrap)}
										style={domStyle(
											inlineStyles.getChatComposerTextAreaWrapStyle(),
										)}
									>
										{!view.usePlainTextarea && (
											<div
												ref={(_element2) =>
													assignRef(view.highlightOverlayRef, _element2)
												}
												{...stylex.attrs(styles.highlightOverlay)}
												style={domStyle(
													inlineStyles.getChatComposerHighlightOverlayStyle(),
												)}
												aria-hidden="true"
											>
												{view.inputHighlights}
											</div>
										)}
										<textarea
											ref={(_element3) =>
												assignRef(view.textareaRef, _element3)
											}
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
											spellcheck
											autocorrect="on"
											autocapitalize="sentences"
											{...stylex.attrs(styles.textarea)}
											style={domStyle(
												inlineStyles.getChatComposerTextareaStyle(
													view.usePlainTextarea
														? runtimeColor.textMain
														: "transparent",
													view.usePlainTextarea
														? runtimeColor.textMain
														: "transparent",
												),
											)}
										/>
									</div>
								</div>
								<ComposerControls {...view} />
							</div>
						</LiquidItem>
					</GooeyRoot>
				</div>
			}

			<Show when={view.activeControl} keyed>
				{(control) => <ProviderConfigMenu {...view} activeControl={control} />}
			</Show>

			{view.mdPreview.show && <MarkdownPreviewDialog {...view} />}
		</>
	);
};
