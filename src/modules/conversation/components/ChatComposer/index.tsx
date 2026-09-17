import {
	iconSize,
	runtimeColor,
	surfaceStyles,
} from "@design-system/styles.stylex.ts";
import { ariaValue, assignRef, domStyle } from "@shared/lib/dom.tsx";
import { BorderBeamOverlay } from "@shared/ui/BorderBeamOverlay/index.tsx";
import { IconButton } from "@shared/ui/IconButton/index.tsx";
import {
	IconAlertTriangle,
	IconMic,
	IconPlus,
	IconStop,
} from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createEffect, onSettled, Show } from "solid-js";
import { InputHighlights } from "../ChatTokenDecorators/index.tsx";
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
	let textareaElement: HTMLTextAreaElement | undefined;
	createEffect(
		() => [props.input, props.active !== false] as const,
		([input, active]) => {
			if (!active || !textareaElement) return;
			textareaElement.style.height = "20px";
			if (input)
				textareaElement.style.height = `${Math.min(Math.max(textareaElement.scrollHeight, 20), 120)}px`;
			const overlay = props.highlightOverlayRef.current;
			if (overlay)
				overlay.style.transform = `translateY(-${textareaElement.scrollTop}px)`;
		},
	);
	onSettled(() => {
		const textareaRef = props.textareaRef;
		const overlayRef = props.highlightOverlayRef;
		const overlay = overlayRef.current;
		return () => {
			if (textareaRef.current === textareaElement) textareaRef.current = null;
			if (overlayRef.current === overlay) overlayRef.current = null;
		};
	});
	const textarea = (element: HTMLTextAreaElement) => {
		textareaElement = element;
		props.textareaRef.current = element;
	};
	return (
		<>
			<input
				type="file"
				ref={(_element) => assignRef(view.fileInputRef, _element)}
				accept="image/*"
				multiple
				{...stylex.attrs(styles.hidden)}
				onInput={async (e) => {
					const input = e.currentTarget;
					const files = Array.from(input.files || []).filter((file) =>
						file.type.startsWith("image/"),
					);
					await Promise.all(files.map((file) => view.attachImage(file)));
					input.value = "";
				}}
			/>

			{view.attachedImages.length > 0 && <ComposerAttachments {...view} />}

			{
				<div
					{...stylex.attrs(styles.inputDock)}
					class={`${stylex.attrs(styles.inputDock).class ?? ""} inferay-chat-composer`}
				>
					<div
						data-chat-composer-frame
						{...stylex.attrs(surfaceStyles.panel, styles.inputFrame)}
					>
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
												!view.voiceInput.isListening && view.voiceInput.error
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
										<InputHighlights
											text={view.input}
											slashCommandNames={view.slashCommandNames}
										/>
									</div>
								)}
								<textarea
									data-chat-composer
									ref={textarea}
									value={view.input}
									onFocus={() => view.setMessageInputFocused(true)}
									onBlur={() => view.setMessageInputFocused(false)}
									onInput={(e) => {
										const val = e.currentTarget.value;
										view.setInput(val);
										const cursor = e.currentTarget.selectionStart ?? val.length;
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
				</div>
			}

			<Show when={view.activeControl}>
				{(control) => (
					<ProviderConfigMenu {...view} activeControl={control()} />
				)}
			</Show>

			{view.mdPreview.show && <MarkdownPreviewDialog {...view} />}
		</>
	);
};
