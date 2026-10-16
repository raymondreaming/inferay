import {
	iconSize,
	runtimeColor,
	surfaceStyles,
} from "@design-system/styles.stylex.ts";
import type { RefCell } from "@shared/lib/dom.tsx";
import { ariaValue, assignRef } from "@shared/lib/dom.tsx";
import { BorderBeamOverlay } from "@shared/ui/BorderBeamOverlay/index.tsx";
import { IconButton } from "@shared/ui/IconButton/index.tsx";
import {
	IconAlertTriangle,
	IconMic,
	IconPlus,
	IconStop,
} from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal, onSettled } from "solid-js";
import type { useAgentChatComposerState } from "../../hooks/useAgentChatComposerState.tsx";
import type { useAgentChatMenus } from "../../hooks/useAgentChatMenus.tsx";
import type { useSpeechToText } from "../../hooks/useSpeechToText.tsx";
import { InputHighlights } from "../ChatTokenDecorators/index.tsx";
import { CommandMenu } from "./CommandMenu.tsx";
import { ComposerAttachments } from "./ComposerAttachments.tsx";
import { ComposerControls } from "./ComposerControls.tsx";
import { FileMenu } from "./FileMenu.tsx";
import { MarkdownPreviewDialog } from "./MarkdownPreviewDialog.tsx";
import { QueuedMessages } from "./QueuedMessages.tsx";
import { styles } from "./styles.ts";

export const ChatComposer = function ChatComposer(
	props: ReturnType<typeof useAgentChatComposerState> &
		ReturnType<typeof useAgentChatMenus> &
		Parameters<typeof ComposerControls>[0] & {
			active?: boolean;
			input: string;
			setInput: (value: string) => void;
			handleKeyDown: (event: KeyboardEvent) => void;
			textareaRef: RefCell<HTMLTextAreaElement | null>;
			highlightOverlayRef: RefCell<HTMLDivElement | null>;
			voiceInput?: ReturnType<typeof useSpeechToText>;
			beamActive?: boolean;
		},
) {
	const [messageInputFocused, setMessageInputFocused] = createSignal(false);
	const usePlainTextarea = createMemo(() => props.input.length > 6000);
	let fileInput: HTMLInputElement | undefined;
	let textareaElement: HTMLTextAreaElement | undefined;
	let measuredInput: string | undefined;
	createEffect(
		() => [props.input, props.active !== false] as const,
		([input, active]) => {
			if (!active || !textareaElement || input === measuredInput) return;
			measuredInput = input;
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
				ref={(element) => {
					fileInput = element;
				}}
				accept="image/*"
				multiple
				{...stylex.attrs(styles.hidden)}
				onInput={async (e) => {
					const input = e.currentTarget;
					const files = Array.from(input.files || []).filter((file) =>
						file.type.startsWith("image/"),
					);
					await Promise.all(files.map((file) => props.attachImage(file)));
					input.value = "";
				}}
			/>

			{props.attachedImages.length > 0 && <ComposerAttachments {...props} />}

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
							active={props.beamActive || messageInputFocused()}
						/>
						{props.fileMenu.show && props.fileResults.length > 0 && (
							<FileMenu {...props} />
						)}
						{props.showCommands && <CommandMenu {...props} />}
						{props.queuedMessages.length > 0 && <QueuedMessages {...props} />}

						<div {...stylex.attrs(styles.inputRow)}>
							<div {...stylex.attrs(styles.inputActions)}>
								<IconButton
									type="button"
									onClick={() => fileInput?.click()}
									variant="ghost"
									size="md"
									class={stylex.attrs(styles.noShrink).class}
									title="Attach image"
								>
									<IconPlus size={iconSize.xl} />
								</IconButton>
								{props.voiceInput && (
									<IconButton
										type="button"
										onClick={props.voiceInput.toggleListening}
										variant="ghost"
										size="md"
										class={
											stylex.attrs(
												styles.noShrink,
												props.voiceInput.isListening &&
													styles.voiceButtonListening,
												!props.voiceInput.isListening && props.voiceInput.error
													? styles.voiceButtonError
													: null,
											).class
										}
										title={
											props.voiceInput.error && !props.voiceInput.isListening
												? props.voiceInput.error
												: props.voiceInput.isSupported
													? props.voiceInput.isListening
														? "Stop voice input"
														: "Start voice input"
													: "Voice input is not supported in this browser"
										}
										aria-label={ariaValue(
											props.voiceInput.isListening
												? "Stop voice input"
												: props.voiceInput.error
													? props.voiceInput.error
													: "Start voice input",
										)}
										aria-pressed={ariaValue(props.voiceInput.isListening)}
										disabled={!props.voiceInput.isSupported}
									>
										{props.voiceInput.isListening ? (
											<IconStop size={iconSize._2md} />
										) : props.voiceInput.error ? (
											<IconAlertTriangle size={iconSize._2lg} />
										) : (
											<IconMic size={iconSize.xl} />
										)}
									</IconButton>
								)}
							</div>

							<div
								{...stylex.attrs(styles.textAreaWrap)}
								style={{
									"max-height": "120px",
								}}
							>
								{!usePlainTextarea() && (
									<div
										ref={(_element2) =>
											assignRef(props.highlightOverlayRef, _element2)
										}
										{...stylex.attrs(styles.highlightOverlay)}
										style={{
											"line-height": "20px",
											"word-break": "break-word",
											"overflow-wrap": "break-word",
										}}
										aria-hidden="true"
									>
										<InputHighlights
											text={props.input}
											slashCommandNames={props.slashCommandNames}
										/>
									</div>
								)}
								<textarea
									data-chat-composer
									ref={textarea}
									value={props.input}
									onFocus={() => setMessageInputFocused(true)}
									onBlur={() => setMessageInputFocused(false)}
									onInput={(e) => {
										const val = e.currentTarget.value;
										props.setInput(val);
										const cursor = e.currentTarget.selectionStart ?? val.length;
										props.handleInputForFileMenu(val, cursor);
										props.handleInputForSlashMenu(val, cursor);
										if (props.highlightOverlayRef.current) {
											props.highlightOverlayRef.current.style.transform = `translateY(-${e.currentTarget.scrollTop}px)`;
										}
									}}
									onScroll={(e) => {
										if (props.highlightOverlayRef.current) {
											props.highlightOverlayRef.current.style.transform = `translateY(-${e.currentTarget.scrollTop}px)`;
										}
									}}
									onKeyDown={props.handleKeyDown}
									onPaste={props.handlePaste}
									placeholder="Message… (/ commands, @ files)"
									rows={1}
									aria-label="Message input"
									spellcheck
									autocorrect="on"
									autocapitalize="sentences"
									{...stylex.attrs(styles.textarea)}
									style={{
										"min-height": "20px",
										color: usePlainTextarea()
											? runtimeColor.textMain
											: "transparent",
										"caret-color": runtimeColor.textMain,
										"-webkit-text-fill-color": usePlainTextarea()
											? runtimeColor.textMain
											: "transparent",
										"line-height": "20px",
										"word-break": "break-word",
										"overflow-wrap": "break-word",
									}}
								/>
							</div>
						</div>
						<ComposerControls {...props} />
					</div>
				</div>
			}

			{props.mdPreview.show && <MarkdownPreviewDialog {...props} />}
		</>
	);
};
