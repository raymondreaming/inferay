import * as stylex from "@octanejs/stylex";
import { memo, useEffect, useMemo, useRef, useState } from "octane";
import type React from "react";
import {
	color,
	controlSize,
	font,
	iconSize,
	layer,
	motion,
	palette,
	radius,
	runtimeColor,
	shadow,
	surfaceStyles,
} from "../../../design-system/styles.stylex.ts";
import { getAgentIcon } from "../../../modules/agents/components/AgentIcon.tsx";
import {
	CODEX_REASONING_LEVELS,
	getAgentDefinition,
} from "../../../modules/agents/model/agents.ts";
import type {
	AttachedImageInfo,
	QueuedMessageInfo,
	SlashCommand,
} from "../../../modules/conversation/model/agent-chat-shared.ts";
import type { AgentKind } from "../../../modules/workspace/model/workspace-model.ts";
import { hasId } from "../../../shared/lib/data.ts";
import { setInputValue } from "../../../shared/lib/react-events.ts";
import { BorderBeamOverlay } from "../../../shared/ui/BorderBeamOverlay.tsx";
import { Liquid } from "../../../shared/ui/gooey/index.ts";
import { IconButton } from "../../../shared/ui/IconButton.tsx";
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
} from "../../../shared/ui/Icons.tsx";
import type { ReactNode } from "../../../types/octane-react-compat.ts";
import { openSkills } from "../../skills/model/skill-events.ts";
import type {
	FileMenuState,
	FileSearchResult,
	SlashMenuState,
} from "../hooks/useAgentChatMenus.tsx";
import { renderInputHighlights } from "../model/chat-token-decorators.tsx";
import { Markdown } from "./ChatRichContent.tsx";

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
		<div {...stylex.props(styles.commandRowWrap)}>
			<button
				type="button"
				onClick={() => selectCommand(index)}
				onMouseEnter={() =>
					setSlashMenu((prev) =>
						prev.selectedIdx === index ? prev : { ...prev, selectedIdx: index },
					)
				}
				{...stylex.props(
					styles.commandRow,
					selected && styles.commandRowActive,
				)}
			>
				<span {...stylex.props(styles.commandTitleLine)}>
					<span {...stylex.props(styles.commandName)}>/{command.name}</span>
					{command.isLocalCommand && (
						<span {...stylex.props(styles.commandBadge)}>Native</span>
					)}
				</span>
			</button>
			{command.isFromLibrary && command.id && (
				<button
					type="button"
					title={`Edit /${command.name}`}
					aria-label={`Edit /${command.name}`}
					onClick={() => {
						setSlashMenu((prev) => ({ ...prev, show: false }));
						openSkills({ mode: "edit", skillId: command.id! });
					}}
					{...stylex.props(styles.commandEdit)}
				>
					<IconPencil size={iconSize.sm} />
				</button>
			)}
		</div>
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
	workspaceControl,
	beamActive = false,
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
	workspaceControl?: ReactNode;
	beamActive?: boolean;
}) {
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const agentConfigControlsRef = useRef<HTMLDivElement | null>(null);
	const agentConfigButtonRef = useRef<HTMLButtonElement | null>(null);
	const agentConfigMenuRef = useRef<HTMLDivElement | null>(null);
	const [activeConfig, setActiveConfig] = useState<string | null>(null);
	const agentConfigOpen = activeConfig !== null;
	const [messageInputFocused, setMessageInputFocused] = useState(false);
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
	const selectedModel = agentDefinition.models.find(hasId.bind(null, model));
	const selectedModelLabel = selectedModel?.label || model || "No model";
	const selectedReasoningLabel =
		CODEX_REASONING_LEVELS.find(hasId.bind(null, reasoningLevel))?.label ||
		reasoningLevel;
	const configControls = [
		{
			id: "provider",
			title: "Provider",
			label: agentDefinition.label,
			value: agentKind,
			options: agentKindOptions,
			icon: getAgentIcon(agentKind, 10),
			onChange: (id: string) => onAgentKindChange(id as AgentKind),
		},
		...(agentDefinition.models.length
			? [
					{
						id: "model",
						title: "Model",
						label: selectedModel?.shortLabel || selectedModelLabel,
						value: model,
						options: agentDefinition.models,
						icon: null,
						onChange: onModelChange,
					},
				]
			: []),
		...(agentKind === "codex"
			? [
					{
						id: "reasoning",
						title: "Reasoning",
						label: selectedReasoningLabel,
						value: reasoningLevel,
						options: CODEX_REASONING_LEVELS,
						icon: null,
						onChange: onReasoningLevelChange,
					},
				]
			: []),
	];
	const activeControl = configControls.find(
		(control) => control.id === activeConfig,
	);
	useEffect(() => {
		if (!agentConfigOpen) return;
		const handlePointerDown = (event: MouseEvent) => {
			const target = event.target as Node;
			if (
				agentConfigMenuRef.current?.contains(target) ||
				agentConfigControlsRef.current?.contains(target)
			)
				return;
			setActiveConfig(null);
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setActiveConfig(null);
				agentConfigButtonRef.current?.focus();
			}
		};
		document.addEventListener("mousedown", handlePointerDown);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [agentConfigOpen]);
	useEffect(() => {
		if (!activeConfig) return;
		const menu = agentConfigMenuRef.current;
		(
			menu?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ??
			menu?.querySelector<HTMLButtonElement>("button")
		)?.focus();
	}, [activeConfig]);
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
								{showCommands && (
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
										<div {...stylex.props(styles.commandFooter)}>
											<button
												type="button"
												onClick={() => {
													setSlashMenu((prev) => ({ ...prev, show: false }));
													openSkills({ mode: "create" });
												}}
												{...stylex.props(styles.menuAction)}
											>
												<IconPlus size={iconSize.sm} /> New skill
											</button>
											<button
												type="button"
												onClick={() => {
													setSlashMenu((prev) => ({ ...prev, show: false }));
													openSkills();
												}}
												{...stylex.props(styles.menuAction)}
											>
												Manage skills
											</button>
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
									<div
										ref={agentConfigControlsRef}
										{...stylex.props(styles.configControls)}
									>
										{configControls.map((control) => (
											<button
												key={control.id}
												type="button"
												aria-label={`${control.title}: ${control.label}`}
												aria-haspopup="menu"
												aria-expanded={activeConfig === control.id}
												title={
													control.id === "model"
														? selectedModelLabel
														: control.title
												}
												onClick={(event) => {
													agentConfigButtonRef.current = event.currentTarget;
													setActiveConfig((current) =>
														current === control.id ? null : control.id,
													);
												}}
												{...stylex.props(
													styles.providerConfigButton,
													activeConfig === control.id &&
														styles.providerConfigChoiceActive,
												)}
											>
												{control.icon}
												<span {...stylex.props(styles.providerConfigLabel)}>
													{control.label}
												</span>
												<IconChevronDown
													size={iconSize.sm}
													{...stylex.props(
														styles.providerConfigChevron,
														activeConfig === control.id &&
															styles.providerConfigChevronOpen,
													)}
												/>
											</button>
										))}
									</div>
									{workspaceControl && (
										<div {...stylex.props(styles.workspaceControl)}>
											{workspaceControl}
										</div>
									)}
								</div>
							</div>
						</Liquid.Item>
					</Liquid>
				</div>
			)}

			{showInput && activeControl && (
				<div
					ref={agentConfigMenuRef}
					{...stylex.props(styles.providerConfigAnchor)}
				>
					<div
						role="menu"
						aria-label={activeControl.title}
						{...stylex.props(styles.providerConfigMenu)}
						onKeyDown={(event) => {
							const buttons = Array.from(
								event.currentTarget.querySelectorAll<HTMLButtonElement>(
									"button",
								),
							);
							const index = buttons.indexOf(
								document.activeElement as HTMLButtonElement,
							);
							const next =
								event.key === "Home"
									? 0
									: event.key === "End"
										? buttons.length - 1
										: event.key === "ArrowDown"
											? (index + 1) % buttons.length
											: event.key === "ArrowUp"
												? (index - 1 + buttons.length) % buttons.length
												: -1;
							if (next >= 0) {
								event.preventDefault();
								buttons[next]?.focus();
							}
							if (event.key === "Tab") setActiveConfig(null);
						}}
					>
						{activeControl.options.map((option) => (
							<button
								key={option.id}
								type="button"
								role="menuitemradio"
								aria-checked={option.id === activeControl.value}
								tabIndex={-1}
								onClick={() => {
									activeControl.onChange(option.id);
									setActiveConfig(null);
									agentConfigButtonRef.current?.focus();
								}}
								{...stylex.props(
									styles.providerConfigChoice,
									option.id === activeControl.value &&
										styles.providerConfigChoiceActive,
								)}
							>
								<span {...stylex.props(styles.providerConfigLabel)}>
									{option.label}
								</span>
								{option.id === activeControl.value && (
									<IconCheck size={iconSize.sm} />
								)}
							</button>
						))}
					</div>
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
		backgroundColor: color.backgroundPanel,
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
		backgroundColor: color.controlActive,
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
		color: color.textMain,
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
		maxHeight: "360px",
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
		paddingLeft: controlSize._3,
		paddingRight: controlSize._10,
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
		backgroundColor: color.controlActive,
	},
	commandRowWrap: { position: "relative" },
	commandEdit: {
		position: "absolute",
		right: controlSize._2,
		top: "50%",
		transform: "translateY(-50%)",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		width: controlSize._6,
		height: controlSize._6,
		borderWidth: 0,
		borderRadius: radius.sm,
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceControl,
		},
		color: color.textMuted,
	},
	commandFooter: {
		display: "flex",
		justifyContent: "space-between",
		padding: controlSize._2,
		borderTopWidth: 1,
		borderTopStyle: "solid",
		borderTopColor: color.border,
	},
	menuAction: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._1,
		borderWidth: 0,
		borderRadius: radius.sm,
		padding: controlSize._1_5,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		color: color.textSoft,
		fontSize: font.size_1,
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
		backgroundColor: color.surfaceControl,
		borderColor: color.border,
		borderRadius: radius.pill,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textMuted,
		fontSize: font.size_0_5,
		fontWeight: font.weight_5,
		paddingBlock: controlSize._0_25,
		paddingInline: controlSize._1,
		textTransform: "uppercase",
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
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 0,
		boxShadow: "none",
		boxSizing: "border-box",
		color: color.textSoft,
		display: "inline-flex",
		flexShrink: 1,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		gap: controlSize._1,
		height: controlSize._6,
		lineHeight: 1,
		maxWidth: "100%",
		minWidth: controlSize._0,
		paddingBlock: controlSize._0,
		paddingInline: controlSize._1,
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
	configControls: {
		alignItems: "center",
		display: "flex",
		flexShrink: 0,
		maxWidth: "100%",
		gap: controlSize._1,
		minWidth: controlSize._0,
	},
	workspaceControl: {
		display: "flex",
		justifyContent: "flex-end",
		marginLeft: "auto",
		minWidth: controlSize._0,
		maxWidth: "100%",
	},
	providerConfigMenu: {
		backgroundColor: color.backgroundPanel,
		borderRadius: radius.px10,
		borderColor: color.border,
		borderStyle: "solid",
		borderWidth: 1,
		boxSizing: "border-box",
		display: "flex",
		flexDirection: "column",
		gap: controlSize._0_5,
		maxHeight: "min(320px, calc(100vh - 160px))",
		overflowY: "auto",
		padding: controlSize._1,
		width: "100%",
	},
	providerConfigAnchor: {
		position: "absolute",
		left: controlSize._3,
		bottom: "calc(100% + 6px)",
		zIndex: layer.composerPopover,
		width: "220px",
		maxWidth: "calc(100% - 24px)",
		pointerEvents: "auto",
	},
	providerConfigChoice: {
		alignItems: "center",
		justifyContent: "space-between",
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
		flexWrap: "wrap",
		gap: "0.375rem",
		minWidth: controlSize._0,
		paddingBottom: controlSize._1,
		paddingInline: controlSize._2,
		position: "relative",
		userSelect: "none",
		zIndex: layer.content,
	},
});
