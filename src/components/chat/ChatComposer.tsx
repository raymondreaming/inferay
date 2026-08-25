import * as stylex from "@octanejs/stylex";
import { memo, useEffect, useMemo, useRef, useState } from "octane";
import type React from "react";
import { iconSize, runtimeColor } from "../../design-system.ts";
import type { AgentKind } from "../../features/agent/agent-utils.ts";
import { getAgentIcon } from "../../features/agents/agent-ui.tsx";
import {
	CODEX_REASONING_LEVELS,
	getAgentDefinition,
} from "../../features/agents/agents.ts";
import type {
	AttachedImageInfo,
	QueuedMessageInfo,
	SlashCommand,
} from "../../features/chat/agent-chat-shared.ts";
import { hasId } from "../../lib/data.ts";
import { setInputValue } from "../../lib/react-events.ts";
import {
	color,
	controlSize,
	font,
	layer,
	motion,
	palette,
	radius,
	shadow,
} from "../../tokens.stylex.ts";
import { Liquid } from "../ui/gooey/index.ts";
import { IconButton } from "../ui/IconButton.tsx";
import {
	IconAlertTriangle,
	IconCheck,
	IconChevronDown,
	IconMic,
	IconPencil,
	IconPlus,
	IconStop,
	IconTrash,
	IconX,
} from "../ui/Icons.tsx";
import { Markdown } from "./ChatRichContent.tsx";
import { renderInputHighlights } from "./chat-token-decorators.tsx";
import type {
	FileMenuState,
	FileSearchResult,
	SlashMenuState,
} from "./useAgentChatMenus.tsx";

type AgentOption = {
	id: AgentKind;
	label: string;
	icon: unknown;
};

const CLOSED_MD_PREVIEW = {
	show: false,
	path: "",
	content: null,
	loading: false,
	error: null,
};

const FileMenuRow = memo(function FileMenuRow({
	file,
	index,
	selected,
	selectFile,
	setFileMenu,
}: {
	file: FileSearchResult;
	index: number;
	selected: boolean;
	selectFile: (idx: number) => void;
	setFileMenu: React.Dispatch<React.SetStateAction<FileMenuState>>;
}) {
	return (
		<button
			type="button"
			onClick={() => selectFile(index)}
			onMouseEnter={() =>
				setFileMenu((prev) =>
					prev.selectedIdx === index ? prev : { ...prev, selectedIdx: index },
				)
			}
			{...stylex.props(
				styles.fileMenuRow,
				selected && styles.fileMenuRowActive,
			)}
		>
			<span {...stylex.props(styles.fileMenuIcon)}>
				{file.isDir ? "\u{1F4C1}" : "\u{1F4C4}"}
			</span>
			<span {...stylex.props(styles.fileMenuName)}>{file.name}</span>
			<span {...stylex.props(styles.fileMenuPath)}>{file.path}</span>
		</button>
	);
});

const CommandMenuRow = memo(function CommandMenuRow({
	command,
	index,
	selected,
	selectCommand,
	setSlashMenu,
}: {
	command: SlashCommand;
	index: number;
	selected: boolean;
	selectCommand: (idx: number) => void;
	setSlashMenu: React.Dispatch<React.SetStateAction<SlashMenuState>>;
}) {
	return (
		<button
			type="button"
			onClick={() => selectCommand(index)}
			onMouseEnter={() =>
				setSlashMenu((prev) =>
					prev.selectedIdx === index ? prev : { ...prev, selectedIdx: index },
				)
			}
			{...stylex.props(styles.commandRow, selected && styles.commandRowActive)}
		>
			<span {...stylex.props(styles.commandTitleLine)}>
				<span
					{...stylex.props(
						styles.commandName,
						selected && styles.commandNameActive,
					)}
				>
					/{command.name}
				</span>
				{command.isLocalCommand && (
					<span {...stylex.props(styles.commandBadge)}>Native</span>
				)}
			</span>
		</button>
	);
});

const QueuedMessageRow = memo(function QueuedMessageRow({
	index,
	message,
	isEditing,
	editingQueueText,
	setEditingQueueText,
	startQueuedMessageEdit,
	cancelQueuedMessageEdit,
	saveQueuedMessageEdit,
	removeQueuedMessage,
}: {
	index: number;
	message: QueuedMessageInfo;
	isEditing: boolean;
	editingQueueText: string;
	setEditingQueueText: (text: string) => void;
	startQueuedMessageEdit: (id: string, text: string) => void;
	cancelQueuedMessageEdit: () => void;
	saveQueuedMessageEdit: (id: string) => void;
	removeQueuedMessage: (id: string) => void;
}) {
	const editInputRef = useRef<HTMLInputElement | null>(null);
	useEffect(() => {
		if (isEditing) editInputRef.current?.focus();
	}, [isEditing]);
	return (
		<div {...stylex.props(styles.queueRow)}>
			<span {...stylex.props(styles.queueIndex)}>{index + 1}</span>
			{isEditing ? (
				<div {...stylex.props(styles.queueEditRow)}>
					<input
						ref={editInputRef}
						type="text"
						value={editingQueueText}
						onInput={setInputValue.bind(null, setEditingQueueText)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								saveQueuedMessageEdit(message.id);
							} else if (e.key === "Escape") {
								cancelQueuedMessageEdit();
							}
						}}
						{...stylex.props(styles.queueEditInput)}
					/>
					<IconButton
						type="button"
						onClick={() => saveQueuedMessageEdit(message.id)}
						variant="ghost"
						size="xs"
						className={stylex.props(styles.saveButton).className}
						title="Save"
					>
						<IconCheck size={iconSize.compact} />
					</IconButton>
					<IconButton
						type="button"
						onClick={cancelQueuedMessageEdit}
						variant="ghost"
						size="xs"
						title="Cancel"
					>
						<IconX size={iconSize.compact} />
					</IconButton>
				</div>
			) : (
				<>
					{message.images && message.images.length > 0 && (
						<img
							src={`/api/file?path=${encodeURIComponent(message.images[0]!)}`}
							alt=""
							{...stylex.props(styles.queueImage)}
						/>
					)}
					<span {...stylex.props(styles.queueText)}>{message.displayText}</span>
					{message.transient ? (
						<span {...stylex.props(styles.queueIndex)}>Steering…</span>
					) : (
						<div {...stylex.props(styles.queueActions)}>
							<IconButton
								type="button"
								onClick={() => startQueuedMessageEdit(message.id, message.text)}
								variant="ghost"
								size="xs"
								title="Edit"
							>
								<IconPencil size={iconSize.compact} />
							</IconButton>
							<IconButton
								type="button"
								onClick={() => removeQueuedMessage(message.id)}
								variant="danger"
								size="xs"
								title="Remove from queue"
							>
								<IconTrash size={iconSize.compact} />
							</IconButton>
						</div>
					)}
				</>
			)}
		</div>
	);
});

export const ChatComposer = memo(function ChatComposer({
	showInput,
	agentKind,
	agentKindOptions,
	model,
	reasoningLevel,
	onAgentKindChange,
	onModelChange,
	onReasoningLevelChange,
	onAgentConfigOpenChange,
	input,
	setInput,
	isLoading,
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
	slashCommandNames,
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
}: {
	showInput: boolean;
	agentKind: AgentKind;
	agentKindOptions: AgentOption[];
	model: string;
	reasoningLevel: string;
	onAgentKindChange: (agentKind: AgentKind) => void;
	onModelChange: (model: string) => void;
	onReasoningLevelChange: (reasoningLevel: string) => void;
	onAgentConfigOpenChange?: (open: boolean) => void;
	input: string;
	setInput: (value: string) => void;
	isLoading: boolean;
	attachedImages: AttachedImageInfo[];
	removeAttachedImage: (path: string) => void;
	attachImage: (file: File) => Promise<void>;
	queuedMessages: QueuedMessageInfo[];
	editingQueueId: string | null;
	editingQueueText: string;
	setEditingQueueText: (text: string) => void;
	startQueuedMessageEdit: (id: string, text: string) => void;
	cancelQueuedMessageEdit: () => void;
	saveQueuedMessageEdit: (id: string) => void;
	removeQueuedMessage: (id: string) => void;
	fileMenu: FileMenuState;
	setFileMenu: React.Dispatch<React.SetStateAction<FileMenuState>>;
	fileResults: FileSearchResult[];
	selectFile: (idx: number) => void;
	slashMenu: SlashMenuState;
	setSlashMenu: React.Dispatch<React.SetStateAction<SlashMenuState>>;
	showCommands: boolean;
	filteredCommands: SlashCommand[];
	slashCommandNames: readonly string[];
	selectCommand: (idx: number) => void;
	handleInputForFileMenu: (value: string, cursorPos: number) => void;
	handleInputForSlashMenu: (value: string, cursorPos: number) => void;
	handleKeyDown: (e: KeyboardEvent) => void;
	handlePaste: (e: ClipboardEvent) => void;
	textareaRef: React.RefObject<HTMLTextAreaElement | null>;
	highlightOverlayRef: React.RefObject<HTMLDivElement | null>;
	inputContainerRef: React.RefObject<HTMLDivElement | null>;
	mdPreview: {
		show: boolean;
		path: string;
		content: string | null;
		loading: boolean;
		error: string | null;
	};
	setMdPreview: React.Dispatch<
		React.SetStateAction<{
			show: boolean;
			path: string;
			content: string | null;
			loading: boolean;
			error: string | null;
		}>
	>;
	onMdFileClick: (path: string) => void;
	voiceInput?: {
		error: string | null;
		isListening: boolean;
		isSupported: boolean;
		onToggleListening: () => void;
	};
}) {
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const agentConfigButtonRef = useRef<HTMLButtonElement | null>(null);
	const agentConfigMenuRef = useRef<HTMLDivElement | null>(null);
	const [agentConfigOpen, setAgentConfigOpen] = useState(false);
	useEffect(() => {
		onAgentConfigOpenChange?.(agentConfigOpen);
	}, [agentConfigOpen, onAgentConfigOpenChange]);
	useEffect(
		() => () => onAgentConfigOpenChange?.(false),
		[onAgentConfigOpenChange],
	);
	const usePlainTextarea = input.length > 6000;
	const inputHighlights = useMemo(
		() =>
			usePlainTextarea ? null : renderInputHighlights(input, slashCommandNames),
		[input, slashCommandNames, usePlainTextarea],
	);
	const agentDefinition = getAgentDefinition(agentKind);
	const modelOptions = useMemo(
		() =>
			agentDefinition.models.map((option) => ({
				...option,
				icon: getAgentIcon(agentKind, 12),
			})),
		[agentDefinition.models, agentKind],
	);
	const selectedModelLabel =
		modelOptions.find(hasId.bind(null, model))?.label || model || "No model";
	const selectedReasoningLabel =
		CODEX_REASONING_LEVELS.find(hasId.bind(null, reasoningLevel))?.label ||
		reasoningLevel;
	useEffect(() => {
		if (!agentConfigOpen) return;
		const handlePointerDown = (event: MouseEvent) => {
			const target = event.target as Node;
			if (
				agentConfigMenuRef.current?.contains(target) ||
				agentConfigButtonRef.current?.contains(target)
			)
				return;
			setAgentConfigOpen(false);
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setAgentConfigOpen(false);
		};
		document.addEventListener("mousedown", handlePointerDown);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [agentConfigOpen]);
	const toggleAgentConfig = () => {
		setAgentConfigOpen((open) => !open);
	};
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
				<section
					{...stylex.props(styles.attachments)}
					aria-label="Attached images"
				>
					{attachedImages.map((img) => (
						<div key={img.path} {...stylex.props(styles.attachmentTile)}>
							<img
								src={img.previewUrl}
								alt={img.name}
								title={img.name}
								{...stylex.props(styles.attachmentImage)}
							/>
							<IconButton
								type="button"
								onClick={() => removeAttachedImage(img.path)}
								variant="ghost"
								size="xs"
								className={stylex.props(styles.attachmentRemove).className}
								title="Remove image"
							>
								<IconX size={iconSize.sm} />
							</IconButton>
						</div>
					))}
				</section>
			)}

			{showInput && (
				<div
					{...stylex.props(styles.inputDock)}
					className={`${stylex.props(styles.inputDock).className ?? ""} inferay-chat-composer`}
				>
					<Liquid
						blur={5}
						contrast={20}
						fill={runtimeColor.backgroundRaised}
						filterPadding={18}
						shadow="inset 0 1px 0 rgba(255,255,255,.08), 0 8px 24px rgba(0,0,0,.2)"
						className="inferay-message-liquid"
					>
						<Liquid.Item observe radius={12}>
							<div
								{...stylex.props(styles.inputFrame, styles.inputFrameLiquid)}
								ref={inputContainerRef}
							>
								{fileMenu.show && fileResults.length > 0 && (
									<div {...stylex.props(styles.floatingMenu, styles.fileMenu)}>
										<div {...stylex.props(styles.menuHeader)}>
											FILES
											{fileMenu.query ? ` matching "${fileMenu.query}"` : ""}
										</div>
										{fileResults.map((file, idx) => (
											<FileMenuRow
												key={file.path}
												file={file}
												index={idx}
												selected={idx === fileMenu.selectedIdx}
												selectFile={selectFile}
												setFileMenu={setFileMenu}
											/>
										))}
									</div>
								)}
								{showCommands && filteredCommands.length > 0 && (
									<div
										{...stylex.props(styles.floatingMenu, styles.commandMenu)}
									>
										<div {...stylex.props(styles.commandList)}>
											{filteredCommands.map((command, idx) => (
												<CommandMenuRow
													key={command.id || command.name}
													command={command}
													index={idx}
													selected={idx === slashMenu.selectedIdx}
													selectCommand={selectCommand}
													setSlashMenu={setSlashMenu}
												/>
											))}
										</div>
									</div>
								)}
								{queuedMessages.length > 0 && (
									<div {...stylex.props(styles.queueList)}>
										{queuedMessages.map((qm, idx) => (
											<QueuedMessageRow
												key={qm.id}
												index={idx}
												message={qm}
												isEditing={editingQueueId === qm.id}
												editingQueueText={editingQueueText}
												setEditingQueueText={setEditingQueueText}
												startQueuedMessageEdit={startQueuedMessageEdit}
												cancelQueuedMessageEdit={cancelQueuedMessageEdit}
												saveQueuedMessageEdit={saveQueuedMessageEdit}
												removeQueuedMessage={removeQueuedMessage}
											/>
										))}
									</div>
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
										style={{ maxHeight: "120px" }}
									>
										{!usePlainTextarea && (
											<div
												ref={highlightOverlayRef}
												{...stylex.props(styles.highlightOverlay)}
												style={{
													lineHeight: "20px",
													wordBreak: "break-word",
													overflowWrap: "break-word",
												}}
												aria-hidden="true"
											>
												{inputHighlights}
											</div>
										)}
										<textarea
											ref={textareaRef}
											value={input}
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
											style={{
												minHeight: "20px",
												color: usePlainTextarea
													? runtimeColor.textMain
													: "transparent",
												caretColor: runtimeColor.textMain,
												WebkitTextFillColor: usePlainTextarea
													? runtimeColor.textMain
													: "transparent",
												lineHeight: "20px",
												wordBreak: "break-word",
												overflowWrap: "break-word",
											}}
										/>
									</div>
								</div>
								<div {...stylex.props(styles.pickerRow)}>
									<button
										type="button"
										ref={agentConfigButtonRef}
										onClick={toggleAgentConfig}
										{...stylex.props(styles.providerConfigButton)}
										title={`${agentDefinition.label} / ${selectedModelLabel} / ${selectedReasoningLabel}`}
									>
										<span {...stylex.props(styles.accentText)}>
											{getAgentIcon(agentKind, 10)}
										</span>
										<span {...stylex.props(styles.providerConfigLabel)}>
											{agentDefinition.label}
										</span>
										<IconChevronDown
											size={iconSize.sm}
											{...stylex.props(
												styles.providerConfigChevron,
												agentConfigOpen && styles.providerConfigChevronOpen,
											)}
										/>
									</button>
								</div>
							</div>
						</Liquid.Item>
					</Liquid>
				</div>
			)}

			{agentConfigOpen && (
				<div
					ref={agentConfigMenuRef}
					{...stylex.props(styles.providerConfigAnchor)}
				>
					<Liquid
						blur={5}
						contrast={20}
						fill={runtimeColor.backgroundRaised}
						filterPadding={20}
						shadow="inset 0 1px 0 rgba(255,255,255,.08), 0 14px 36px rgba(0,0,0,.32)"
						className={stylex.props(styles.providerConfigLiquid).className}
					>
						<Liquid.Item observe radius={12}>
							<div {...stylex.props(styles.providerConfigMenu)}>
								<div {...stylex.props(styles.providerConfigSection)}>
									<span {...stylex.props(styles.providerConfigSectionLabel)}>
										Provider
									</span>
									<div {...stylex.props(styles.providerConfigChoiceGrid)}>
										{agentKindOptions.map((option) => (
											<button
												type="button"
												key={option.id}
												onClick={() => onAgentKindChange(option.id)}
												{...stylex.props(
													styles.providerConfigChoice,
													option.id === agentKind &&
														styles.providerConfigChoiceActive,
												)}
											>
												<span {...stylex.props(styles.shrink)}>
													{option.icon}
												</span>
												<span>{option.label}</span>
											</button>
										))}
									</div>
								</div>
								{agentDefinition.models.length > 0 && (
									<div {...stylex.props(styles.providerConfigSection)}>
										<span {...stylex.props(styles.providerConfigSectionLabel)}>
											Model
										</span>
										<div {...stylex.props(styles.providerConfigChoiceGrid)}>
											{modelOptions.map((option) => (
												<button
													type="button"
													key={option.id}
													onClick={() => onModelChange(option.id)}
													{...stylex.props(
														styles.providerConfigChoice,
														option.id === model &&
															styles.providerConfigChoiceActive,
													)}
												>
													<span>{option.label}</span>
												</button>
											))}
										</div>
									</div>
								)}
								{agentKind === "codex" && (
									<div {...stylex.props(styles.providerConfigSection)}>
										<span {...stylex.props(styles.providerConfigSectionLabel)}>
											Reasoning
										</span>
										<div {...stylex.props(styles.providerConfigChoiceGrid)}>
											{CODEX_REASONING_LEVELS.map((option) => (
												<button
													type="button"
													key={option.id}
													onClick={() => onReasoningLevelChange(option.id)}
													{...stylex.props(
														styles.providerConfigChoice,
														option.id === reasoningLevel &&
															styles.providerConfigChoiceActive,
													)}
												>
													<span>{option.label}</span>
												</button>
											))}
										</div>
									</div>
								)}
							</div>
						</Liquid.Item>
					</Liquid>
				</div>
			)}

			{mdPreview.show && (
				<div {...stylex.props(styles.modalBackdrop)}>
					<button
						type="button"
						aria-label="Close markdown preview"
						{...stylex.props(styles.modalBackdropButton)}
						onClick={setMdPreview.bind(null, CLOSED_MD_PREVIEW)}
					/>
					<div {...stylex.props(styles.modal)}>
						<div {...stylex.props(styles.modalHeader)}>
							<span {...stylex.props(styles.modalTitle)}>{mdPreview.path}</span>
							<IconButton
								type="button"
								onClick={setMdPreview.bind(null, CLOSED_MD_PREVIEW)}
								variant="ghost"
								size="xs"
							>
								<IconX size={iconSize.lg} />
							</IconButton>
						</div>
						<div {...stylex.props(styles.modalBody)}>
							{mdPreview.loading && (
								<div {...stylex.props(styles.modalState)}>
									<span {...stylex.props(styles.modalStateText)}>Loading…</span>
								</div>
							)}
							{mdPreview.error && (
								<div {...stylex.props(styles.modalState)}>
									<span {...stylex.props(styles.modalError)}>
										{mdPreview.error}
									</span>
								</div>
							)}
							{mdPreview.content && (
								<Markdown
									text={mdPreview.content}
									onMdFileClick={onMdFileClick}
								/>
							)}
						</div>
					</div>
				</div>
			)}
		</>
	);
});

const styles = stylex.create({
	hidden: {
		display: "none",
	},
	attachments: {
		display: "flex",
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._2,
		overflowX: "auto",
		overflowY: "hidden",
		paddingBlock: "0.375rem",
		paddingInline: controlSize._3,
	},
	attachmentTile: {
		position: "relative",
		width: "3.5rem",
		height: "3.5rem",
		flexShrink: 0,
		overflow: "hidden",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: controlSize._2,
	},
	attachmentImage: {
		width: "100%",
		height: "100%",
		objectFit: "cover",
	},
	attachmentRemove: {
		position: "absolute",
		right: controlSize._1,
		top: controlSize._1,
		width: controlSize._5,
		height: controlSize._5,
		borderRadius: radius.pill,
		backgroundColor: color.surfaceBlack70,
		color: palette.white,
	},
	queueList: {
		borderBottomColor: color.borderSubtle,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		flexShrink: 0,
		maxHeight: "112px",
		overflowY: "auto",
		paddingBlock: controlSize._1,
		paddingInline: controlSize._1,
	},
	queueRow: {
		alignItems: "flex-start",
		borderRadius: radius.lg,
		display: "flex",
		gap: controlSize._2,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
		transitionProperty: "background-color",
		transitionDuration: motion.durationFast,
		":hover": {
			backgroundColor: color.backgroundRaised,
		},
	},
	queueIndex: {
		alignItems: "center",
		backgroundColor: color.surfaceSubtle,
		borderRadius: radius.pill,
		color: color.textMuted,
		display: "inline-flex",
		flexShrink: 0,
		fontFamily: "var(--font-diff)",
		fontSize: font.size_1,
		fontVariantNumeric: "tabular-nums",
		height: controlSize._5,
		justifyContent: "center",
		minWidth: controlSize._5,
	},
	queueEditRow: {
		display: "flex",
		flex: 1,
		alignItems: "center",
		gap: controlSize._1,
	},
	queueEditInput: {
		flex: 1,
		borderWidth: 0,
		borderRadius: radius.sm,
		backgroundColor: color.surfaceWhite06,
		color: color.textMain,
		fontSize: font.size_2_75,
		outline: "none",
		paddingBlock: "0.125rem",
		paddingInline: controlSize._1,
	},
	saveButton: {
		color: color.accent,
	},
	queueImage: {
		width: controlSize._5,
		height: controlSize._5,
		flexShrink: 0,
		borderRadius: radius.sm,
		objectFit: "cover",
	},
	queueText: {
		minWidth: controlSize._0,
		flex: 1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontSize: font.size_2_75,
	},
	queueActions: {
		display: "flex",
		flexShrink: 0,
		alignItems: "center",
		gap: "0.125rem",
	},
	floatingMenu: {
		position: "absolute",
		left: controlSize._0,
		right: controlSize._0,
		bottom: "100%",
		zIndex: layer.criticalOverlay,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		backgroundColor: color.backgroundRaised,
	},
	fileMenu: {
		maxHeight: "300px",
		overflowY: "auto",
		marginBottom: controlSize._1,
		borderRadius: controlSize._2,
		boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.6)",
	},
	menuHeader: {
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		letterSpacing: "0.04em",
		paddingBlock: "0.375rem",
		paddingInline: controlSize._3,
	},
	fileMenuRow: {
		display: "flex",
		width: "100%",
		alignItems: "center",
		gap: controlSize._2,
		paddingBlock: "0.375rem",
		paddingInline: controlSize._3,
		textAlign: "left",
		transitionProperty: "background-color",
		transitionDuration: motion.durationFast,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
	},
	fileMenuRowActive: {
		backgroundColor: color.accentWash,
	},
	fileMenuIcon: {
		flexShrink: 0,
		color: color.textMuted,
		fontSize: font.size_2_75,
	},
	fileMenuName: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.accent,
		fontFamily: "var(--font-diff)",
		fontSize: font.size_2_75,
		fontWeight: font.weight_5,
	},
	fileMenuPath: {
		minWidth: controlSize._0,
		flex: 1,
		overflow: "hidden",
		textAlign: "right",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontSize: font.size_1,
	},
	commandMenu: {
		maxHeight: "320px",
		overflow: "hidden",
		marginBottom: controlSize._2,
		borderRadius: radius.lg,
		boxShadow: shadow.modal,
	},
	commandList: {
		maxHeight: "280px",
		overflowY: "auto",
	},
	commandRow: {
		display: "flex",
		width: "100%",
		flexDirection: "column",
		gap: "0.125rem",
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
		textAlign: "left",
		transitionProperty: "background-color",
		transitionDuration: motion.durationFast,
		transitionTimingFunction: motion.ease,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
	},
	commandRowActive: {
		backgroundColor: color.accentWash,
	},
	commandName: {
		color: color.textMain,
		fontFamily: "var(--font-diff)",
		fontSize: font.size_3,
		fontWeight: font.weight_5,
	},
	commandTitleLine: {
		alignItems: "center",
		display: "flex",
		gap: controlSize._2,
		minWidth: controlSize._0,
	},
	commandBadge: {
		backgroundColor: color.accentWash,
		borderColor: color.accentBorder,
		borderRadius: radius.pill,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.accent,
		fontSize: font.size_0_5,
		fontWeight: font.weight_5,
		paddingBlock: controlSize._0_25,
		paddingInline: controlSize._1,
		textTransform: "uppercase",
	},
	commandNameActive: {
		color: color.accent,
	},
	accentText: {
		color: "currentColor",
	},
	shrink: {
		flexShrink: 0,
	},
	providerConfigButton: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		backgroundImage: "none",
		borderColor: color.transparent,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 0,
		boxShadow: "none",
		boxSizing: "border-box",
		color: color.textSoft,
		display: "inline-flex",
		flexShrink: 0,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		gap: controlSize._1,
		height: controlSize._7,
		lineHeight: 1,
		maxWidth: "100%",
		minWidth: controlSize._0,
		paddingBlock: controlSize._0,
		paddingInline: controlSize._2,
		position: "relative",
		zIndex: layer.chrome,
	},
	providerConfigLabel: {
		minWidth: controlSize._0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	providerConfigChevron: {
		color: color.textMuted,
		flexShrink: 0,
		transitionDuration: motion.durationBase,
		transitionProperty: "transform",
	},
	providerConfigChevronOpen: {
		transform: "rotate(180deg)",
	},
	providerConfigMenu: {
		backgroundColor: color.transparent,
		backgroundImage: "none",
		borderRadius: radius.px10,
		borderWidth: 0,
		boxShadow: "none",
		boxSizing: "border-box",
		display: "flex",
		flexDirection: "column",
		gap: controlSize._3,
		maxHeight: "inherit",
		maxWidth: "100%",
		overflowY: "auto",
		padding: controlSize._3,
		width: "100%",
	},
	providerConfigAnchor: {
		position: "absolute",
		left: controlSize._3,
		right: controlSize._3,
		bottom: "calc(100% + 14px)",
		zIndex: layer.composerPopover,
		boxSizing: "border-box",
		maxHeight: "min(430px, calc(100vh - 32px))",
		pointerEvents: "auto",
		transformOrigin: "bottom center",
		animationName: stylex.keyframes({
			from: {
				opacity: 0,
				transform: "translateY(18px) scale(0.97)",
			},
			to: {
				opacity: 1,
				transform: "translateY(0) scale(1)",
			},
		}),
		animationDuration: motion.durationDeliberate,
		animationTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
	},
	providerConfigLiquid: {
		display: "flex",
		width: "100%",
		maxHeight: "inherit",
	},
	providerConfigSection: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
	},
	providerConfigSectionLabel: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		textTransform: "uppercase",
	},
	providerConfigChoiceGrid: {
		display: "grid",
		gap: controlSize._1,
		gridTemplateColumns: "repeat(auto-fit, minmax(8rem, 1fr))",
	},
	providerConfigChoice: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.transparent,
		},
		backgroundImage: "none",
		borderColor: color.transparent,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: "none",
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
		display: "flex",
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		gap: controlSize._2,
		minHeight: controlSize._7,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
		textAlign: "left",
		transitionDuration: motion.durationBase,
		transitionProperty:
			"background-color, background-image, border-color, box-shadow, color",
		transitionTimingFunction: motion.ease,
	},
	providerConfigChoiceActive: {
		backgroundColor: color.controlActive,
		backgroundImage: "none",
		borderColor: color.border,
		boxShadow: "none",
		color: color.textMain,
	},
	modalBackdrop: {
		position: "absolute",
		inset: controlSize._0,
		zIndex: layer.modal,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: color.backgroundOverlay,
		backdropFilter: "blur(var(--inferay-glass-blur, 4px))",
	},
	modalBackdropButton: {
		position: "absolute",
		inset: controlSize._0,
		borderWidth: 0,
		backgroundColor: color.transparent,
		padding: controlSize._0,
	},
	modal: {
		position: "relative",
		display: "flex",
		width: "90%",
		maxWidth: "42rem",
		maxHeight: "80%",
		flexDirection: "column",
		overflow: "hidden",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: controlSize._2,
		backgroundColor: color.background,
	},
	modalHeader: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
	},
	modalTitle: {
		minWidth: controlSize._0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontSize: font.size_2_75,
		fontWeight: font.weight_5,
	},
	modalBody: {
		flex: 1,
		overflowY: "auto",
		color: color.textMain,
		fontSize: font.size_3,
		padding: controlSize._4,
	},
	modalState: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		paddingBlock: controlSize._8,
	},
	modalStateText: {
		color: color.textMuted,
		fontSize: font.size_2,
	},
	modalError: {
		color: color.danger,
		fontSize: font.size_2,
	},
	inputDock: {
		flexShrink: 0,
		paddingBottom: controlSize._2,
		paddingInline: controlSize._3,
		paddingTop: controlSize._1,
	},
	inputFrame: {
		backgroundColor: color.backgroundRaised,
		borderColor: {
			default: color.border,
			":focus-within": color.border,
		},
		borderRadius: radius.xl,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		flexDirection: "column",
		overflow: "visible",
		position: "relative",
		boxShadow: {
			default: "none",
			":focus-within": "none",
		},
		transitionProperty: "border-color, box-shadow, background-color",
		transitionDuration: motion.durationBase,
	},
	inputFrameLiquid: {
		backgroundColor: color.transparent,
		borderColor: color.transparent,
		boxShadow: "none",
	},
	inputRow: {
		alignItems: "flex-end",
		display: "flex",
		gap: controlSize._1,
		paddingBlock: "0.375rem",
		paddingLeft: controlSize._1,
		paddingRight: controlSize._3,
	},
	inputActions: {
		alignItems: "center",
		display: "flex",
		flexShrink: 0,
		gap: controlSize._0_5,
	},
	noShrink: {
		flexShrink: 0,
	},
	voiceButtonListening: {
		backgroundColor: color.accentWash,
		color: color.textSoft,
	},
	voiceButtonError: {
		backgroundColor: color.warningWash,
		color: color.warning,
	},
	textAreaWrap: {
		flex: 1,
		minWidth: controlSize._0,
		overflow: "hidden",
		position: "relative",
	},
	highlightOverlay: {
		fontSize: font.size_4,
		left: controlSize._0,
		overflowWrap: "break-word",
		paddingRight: controlSize._8,
		pointerEvents: "none",
		position: "absolute",
		right: controlSize._0,
		top: controlSize._0,
		whiteSpace: "pre-wrap",
		wordBreak: "break-word",
	},
	textarea: {
		backgroundColor: color.transparent,
		borderWidth: 0,
		boxShadow: "none",
		cursor: "text",
		display: "block",
		fontSize: font.size_4,
		outline: "none",
		overflowY: "auto",
		paddingRight: controlSize._8,
		position: "relative",
		resize: "none",
		userSelect: "none",
		width: "100%",
	},
	pickerRow: {
		alignItems: "center",
		display: "flex",
		gap: "0.375rem",
		minWidth: controlSize._0,
		overflowX: "auto",
		paddingBottom: controlSize._1,
		paddingInline: controlSize._2,
		position: "relative",
		userSelect: "none",
		zIndex: layer.content,
	},
});
