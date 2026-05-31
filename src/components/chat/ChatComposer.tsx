import * as stylex from "@stylexjs/stylex";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getAgentIcon } from "../../features/agents/agent-ui.tsx";
import {
	CODEX_REASONING_LEVELS,
	getAgentDefinition,
} from "../../features/agents/agents.ts";
import type {
	AttachedImageInfo,
	ComposerContextBlock,
	QueuedMessageInfo,
	SlashCommand,
} from "../../features/chat/agent-chat-shared.ts";
import { describeComposerContextBlock } from "../../features/chat/composer-context.ts";
import type { AgentKind } from "../../features/terminal/terminal-utils.ts";
import { hasId } from "../../lib/data.ts";
import { fetchJsonOr, postJson } from "../../lib/fetch-json.ts";
import { stopPropagation } from "../../lib/react-events.ts";
import {
	color,
	colorValues,
	controlSize,
	effect,
	font,
	motion,
	radius,
	shadow,
} from "../../tokens.stylex.ts";
import { IconButton } from "../ui/IconButton.tsx";
import {
	IconAlertTriangle,
	IconChevronDown,
	IconGitBranch,
	IconMic,
	IconPlus,
	IconStop,
	IconX,
} from "../ui/Icons.tsx";
import { ChatQueueList } from "./ChatQueueList.tsx";
import { Markdown } from "./ChatRichContent.tsx";
import { renderInputHighlights } from "./chat-token-decorators.tsx";
import {
	type ComposerKeyboardActions,
	useChatComposerKeyboard,
} from "./useChatComposerKeyboard.ts";

type AgentOption = {
	id: AgentKind;
	label: string;
	icon: React.ReactNode;
};

interface ComposerQueueState {
	queuedMessages: QueuedMessageInfo[];
	editingQueueId: string | null;
	setEditingQueueId: (id: string | null) => void;
	editingQueueText: string;
	setEditingQueueText: (text: string) => void;
	queueRef: React.RefObject<QueuedMessageInfo[]>;
	setQueuedMessages: (messages: QueuedMessageInfo[]) => void;
}

interface ComposerFilePickerState {
	menu: {
		show: boolean;
		selectedIdx: number;
		query: string;
	};
	setMenu: React.Dispatch<
		React.SetStateAction<{
			show: boolean;
			selectedIdx: number;
			query: string;
			atIndex: number;
			position: {
				top: number;
				left: number;
				width: number;
				maxHeight: number;
			} | null;
		}>
	>;
	results: { name: string; path: string; isDir: boolean }[];
	select: (idx: number) => void;
	onInput: (value: string, cursorPos: number) => void;
}

interface ComposerCommandMenuState {
	menu: { selectedIdx: number };
	setMenu: React.Dispatch<
		React.SetStateAction<{
			show: boolean;
			selectedIdx: number;
			query: string;
			slashIndex: number;
		}>
	>;
	show: boolean;
	commands: SlashCommand[];
	names: readonly string[];
	select: (idx: number) => void;
	onInput: (value: string, cursorPos: number) => void;
}

const HIGHLIGHT_CHAR_LIMIT = 6000;
const APP_REGION_NO_DRAG_CLASS = "electrobun-webkit-app-region-no-drag";
const CLOSED_MD_PREVIEW = {
	show: false,
	path: "",
	content: null,
	loading: false,
	error: null,
};

function noDragClassName(className?: string) {
	return className
		? `${APP_REGION_NO_DRAG_CLASS} ${className}`
		: APP_REGION_NO_DRAG_CLASS;
}

function imageContextUrl(block: ComposerContextBlock): string | null {
	if (block.source !== "artifact" || !block.path) return null;
	if (!/\.(png|jpe?g|gif|webp|bmp|ico)(?:[?#].*)?$/i.test(block.path)) {
		return null;
	}
	return `/api/file?path=${encodeURIComponent(block.path)}`;
}

interface GitBranch {
	name: string;
	current: boolean;
}

function ComposerBranchDropdown({
	cwd,
	branch,
	onBranchChanged,
}: {
	cwd: string;
	branch: string;
	onBranchChanged?: () => void;
}) {
	const buttonRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [branches, setBranches] = useState<GitBranch[]>([]);
	const [busyBranch, setBusyBranch] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [position, setPosition] = useState({
		bottom: 0,
		left: 0,
		width: 240,
		maxHeight: 320,
	});
	const loadBranches = async () => {
		const payload = await fetchJsonOr<{ branches?: GitBranch[] }>(
			`/api/git/branches?cwd=${encodeURIComponent(cwd)}`,
			{ branches: [] }
		);
		setBranches(Array.isArray(payload.branches) ? payload.branches : []);
	};
	useEffect(() => {
		void loadBranches();
	}, [cwd]);
	useEffect(() => {
		if (!open) return;
		const handlePointerDown = (event: MouseEvent) => {
			const target = event.target as Node;
			if (
				menuRef.current?.contains(target) ||
				buttonRef.current?.contains(target)
			) {
				return;
			}
			setOpen(false);
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", handlePointerDown);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [open]);
	const options = branches.length
		? branches
		: [{ name: branch, current: true }];
	const toggle = () => {
		if (!open && buttonRef.current) {
			const rect = buttonRef.current.getBoundingClientRect();
			const width = Math.max(240, rect.width);
			setPosition({
				bottom: window.innerHeight - rect.top + 4,
				left: Math.min(
					Math.max(8, rect.left),
					Math.max(8, window.innerWidth - width - 8)
				),
				width,
				maxHeight: Math.max(180, Math.min(320, rect.top - 12)),
			});
		}
		setOpen((next) => !next);
	};
	const checkout = async (nextBranch: string) => {
		if (nextBranch === branch || busyBranch) return;
		setBusyBranch(nextBranch);
		setError(null);
		try {
			const result = await postJson<{
				ok: boolean;
				branch?: string;
				error?: string;
			}>("/api/git/branches", { cwd, branch: nextBranch });
			if (!result.ok) throw new Error(result.error || "Unable to checkout");
			await loadBranches();
			onBranchChanged?.();
			setOpen(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unable to checkout");
		} finally {
			setBusyBranch(null);
		}
	};

	return (
		<>
			<button
				type="button"
				ref={buttonRef}
				onClick={toggle}
				{...stylex.props(styles.providerConfigButton)}
				title={error ?? branch}
			>
				<IconGitBranch size={10} {...stylex.props(styles.accentText)} />
				<span {...stylex.props(styles.providerConfigLabel)}>
					{busyBranch ? "Switching..." : branch}
				</span>
				<IconChevronDown
					size={10}
					{...stylex.props(
						styles.providerConfigChevron,
						open && styles.providerConfigChevronOpen
					)}
				/>
			</button>
			{open &&
				createPortal(
					<div
						ref={menuRef}
						{...stylex.props(styles.providerConfigMenu)}
						style={{
							bottom: position.bottom,
							left: position.left,
							width: position.width,
							maxHeight: position.maxHeight,
						}}
					>
						<div {...stylex.props(styles.providerConfigSection)}>
							<span {...stylex.props(styles.providerConfigSectionLabel)}>
								Branch
							</span>
							<div {...stylex.props(styles.providerConfigChoiceGrid)}>
								{options.map((option) => (
									<button
										type="button"
										key={option.name}
										onClick={() => checkout(option.name)}
										{...stylex.props(
											styles.providerConfigChoice,
											option.name === branch &&
												styles.providerConfigChoiceActive
										)}
									>
										<IconGitBranch size={11} {...stylex.props(styles.shrink)} />
										<span>{option.name}</span>
									</button>
								))}
							</div>
							{error && (
								<span {...stylex.props(styles.providerConfigError)}>
									{error}
								</span>
							)}
						</div>
					</div>,
					document.body
				)}
		</>
	);
}

export function ChatComposer({
	showInput,
	agentKind,
	agentKindOptions,
	model,
	reasoningLevel,
	onAgentKindChange,
	onModelChange,
	onReasoningLevelChange,
	input,
	setInput,
	isLoading,
	attachedImages,
	removeAttachedImage,
	attachImage,
	queue,
	filePicker,
	commandMenu,
	handlePaste,
	keyboard,
	textareaRef,
	highlightOverlayRef,
	inputContainerRef,
	mdPreview,
	setMdPreview,
	onMdFileClick,
	voiceInput,
	contextBlocks,
	onRemoveContextBlock,
	onClearContextBlocks,
	cwd,
	gitBranch,
	onGitBranchChanged,
}: {
	showInput: boolean;
	agentKind: AgentKind;
	agentKindOptions: AgentOption[];
	model: string;
	reasoningLevel: string;
	onAgentKindChange: (agentKind: AgentKind) => void;
	onModelChange: (model: string) => void;
	onReasoningLevelChange: (reasoningLevel: string) => void;
	input: string;
	setInput: (value: string) => void;
	isLoading: boolean;
	attachedImages: AttachedImageInfo[];
	removeAttachedImage: (path: string) => void;
	attachImage: (file: File) => Promise<void>;
	queue: ComposerQueueState;
	filePicker: ComposerFilePickerState;
	commandMenu: ComposerCommandMenuState;
	handlePaste: (e: React.ClipboardEvent) => void;
	keyboard: ComposerKeyboardActions;
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
	contextBlocks: ComposerContextBlock[];
	onRemoveContextBlock: (id: string) => void;
	onClearContextBlocks: () => void;
	cwd?: string | null;
	gitBranch?: string | null;
	onGitBranchChanged?: () => void;
}) {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const agentConfigButtonRef = useRef<HTMLButtonElement>(null);
	const agentConfigMenuRef = useRef<HTMLDivElement>(null);
	const {
		menu: fileMenu,
		setMenu: setFileMenu,
		results: fileResults,
		select: selectFile,
		onInput: handleInputForFileMenu,
	} = filePicker;
	const {
		menu: slashMenu,
		setMenu: setSlashMenu,
		show: showCommands,
		commands: filteredCommands,
		names: slashCommandNames,
		select: selectCommand,
		onInput: handleInputForSlashMenu,
	} = commandMenu;
	const [agentConfigOpen, setAgentConfigOpen] = useState(false);
	const [agentConfigPosition, setAgentConfigPosition] = useState({
		bottom: 0,
		left: 0,
		width: 360,
		maxHeight: 360,
	});
	const usePlainTextarea = input.length > HIGHLIGHT_CHAR_LIMIT;
	const inputHighlights = useMemo(
		() =>
			usePlainTextarea ? null : renderInputHighlights(input, slashCommandNames),
		[input, slashCommandNames, usePlainTextarea]
	);
	const agentDefinition = getAgentDefinition(agentKind);
	const modelOptions = useMemo(
		() =>
			agentDefinition.models.map((option) => ({
				id: option.id,
				label: option.label,
				icon: getAgentIcon(agentKind, 12),
			})),
		[agentDefinition.models, agentKind]
	);
	const folderLabel = cwd ? cwd.split("/").pop() || cwd : "No folder";
	const selectedModelLabel =
		modelOptions.find(hasId.bind(null, model))?.label || model || "No model";
	const selectedReasoningLabel =
		CODEX_REASONING_LEVELS.find(hasId.bind(null, reasoningLevel))?.label ||
		reasoningLevel;
	const handleKeyDown = useChatComposerKeyboard({
		input,
		keyboard,
		fileMenu,
		fileResultCount: fileResults.length,
		setFileMenu,
		selectFile,
		showCommands,
		commandMenu: slashMenu,
		commandCount: filteredCommands.length,
		setCommandMenu: setSlashMenu,
		selectCommand,
	});
	useEffect(() => {
		if (!agentConfigOpen) return;
		const handlePointerDown = (event: MouseEvent) => {
			const target = event.target as Node;
			if (
				agentConfigMenuRef.current?.contains(target) ||
				agentConfigButtonRef.current?.contains(target)
			) {
				return;
			}
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
		if (!agentConfigOpen && agentConfigButtonRef.current) {
			const rect = agentConfigButtonRef.current.getBoundingClientRect();
			const width = Math.max(340, rect.width);
			setAgentConfigPosition({
				bottom: window.innerHeight - rect.top + 4,
				left: Math.min(
					Math.max(8, rect.left),
					Math.max(8, window.innerWidth - width - 8)
				),
				width,
				maxHeight: Math.max(220, Math.min(380, rect.top - 12)),
			});
		}
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
					for (const file of Array.from(e.target.files || [])) {
						if (file.type.startsWith("image/")) await attachImage(file);
					}
					e.target.value = "";
				}}
			/>

			{attachedImages.length > 0 && (
				<div
					role="group"
					{...stylex.props(styles.attachments)}
					className={noDragClassName(
						stylex.props(styles.attachments).className
					)}
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
								<IconX size={10} />
							</IconButton>
						</div>
					))}
				</div>
			)}

			{showInput && (
				<div
					{...stylex.props(styles.inputDock)}
					className={noDragClassName(stylex.props(styles.inputDock).className)}
				>
					<div {...stylex.props(styles.inputFrame)} ref={inputContainerRef}>
						{fileMenu.show && fileResults.length > 0 && (
							<div {...stylex.props(styles.fileMenu)}>
								<div {...stylex.props(styles.menuHeader)}>
									FILES
									{fileMenu.query ? ` matching "${fileMenu.query}"` : ""}
								</div>
								{fileResults.map((file, idx) => (
									<button
										type="button"
										key={file.path}
										onClick={() => selectFile(idx)}
										onMouseEnter={() =>
											setFileMenu((prev) => ({ ...prev, selectedIdx: idx }))
										}
										{...stylex.props(
											styles.fileMenuRow,
											idx === fileMenu.selectedIdx && styles.fileMenuRowActive
										)}
									>
										<span {...stylex.props(styles.fileMenuIcon)}>
											{file.isDir ? "\u{1F4C1}" : "\u{1F4C4}"}
										</span>
										<span {...stylex.props(styles.fileMenuName)}>
											{file.name}
										</span>
										<span {...stylex.props(styles.fileMenuPath)}>
											{file.path}
										</span>
									</button>
								))}
							</div>
						)}
						{showCommands && filteredCommands.length > 0 && (
							<div {...stylex.props(styles.commandMenu)}>
								<div {...stylex.props(styles.commandHeader)}>Commands</div>
								<div {...stylex.props(styles.commandList)}>
									{filteredCommands.map((cmd, idx) => {
										const isSelected = idx === slashMenu.selectedIdx;
										return (
											<button
												type="button"
												key={cmd.id || cmd.name}
												onClick={() => selectCommand(idx)}
												onMouseEnter={() =>
													setSlashMenu((prev) => ({
														...prev,
														selectedIdx: idx,
													}))
												}
												{...stylex.props(
													styles.commandRow,
													isSelected && styles.commandRowActive
												)}
											>
												<span {...stylex.props(styles.commandTitleLine)}>
													<span
														{...stylex.props(
															styles.commandName,
															isSelected && styles.commandNameActive
														)}
													>
														/{cmd.name}
													</span>
													{cmd.isLocalCommand && (
														<span {...stylex.props(styles.commandBadge)}>
															Native
														</span>
													)}
												</span>
												<span {...stylex.props(styles.commandDescription)}>
													{cmd.description}
												</span>
											</button>
										);
									})}
								</div>
							</div>
						)}
						<ChatQueueList {...queue} />

						{contextBlocks.length > 0 && (
							<div {...stylex.props(styles.contextRail)}>
								<div {...stylex.props(styles.contextHeader)}>
									<span {...stylex.props(styles.contextTitle)}>Reference</span>
									<button
										type="button"
										onClick={onClearContextBlocks}
										{...stylex.props(styles.contextClear)}
									>
										Clear
									</button>
								</div>
								<div {...stylex.props(styles.contextList)}>
									{contextBlocks.map((block) => {
										const imageUrl = imageContextUrl(block);
										return (
											<div
												key={block.id}
												{...stylex.props(styles.contextBlock)}
											>
												{imageUrl ? (
													<img
														src={imageUrl}
														alt=""
														{...stylex.props(styles.contextThumb)}
													/>
												) : null}
												<span {...stylex.props(styles.contextSource)}>
													{block.source}
												</span>
												<span {...stylex.props(styles.contextText)}>
													{describeComposerContextBlock(block)}
												</span>
												<IconButton
													type="button"
													onClick={() => onRemoveContextBlock(block.id)}
													variant="ghost"
													size="xs"
													title="Remove context"
												>
													<IconX size={10} />
												</IconButton>
											</div>
										);
									})}
								</div>
							</div>
						)}

						<div {...stylex.props(styles.inputRow)}>
							<div {...stylex.props(styles.inputActions)}>
								<IconButton
									type="button"
									onClick={() => fileInputRef.current?.click()}
									variant="ghost"
									size="md"
									className="shrink-0"
									title="Attach image"
								>
									<IconPlus size={16} />
								</IconButton>
								{voiceInput && (
									<IconButton
										type="button"
										onClick={voiceInput.onToggleListening}
										variant="ghost"
										size="md"
										className={`shrink-0 ${
											stylex.props(
												voiceInput.isListening && styles.voiceButtonListening,
												!voiceInput.isListening && voiceInput.error
													? styles.voiceButtonError
													: null
											).className ?? ""
										}`}
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
											<IconStop size={13} />
										) : voiceInput.error ? (
											<IconAlertTriangle size={15} />
										) : (
											<IconMic size={16} />
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
									onChange={(e) => {
										const val = e.target.value;
										setInput(val);
										const cursor = e.target.selectionStart ?? val.length;
										handleInputForFileMenu(val, cursor);
										handleInputForSlashMenu(val, cursor);
										if (highlightOverlayRef.current) {
											highlightOverlayRef.current.style.transform = `translateY(-${e.target.scrollTop}px)`;
										}
									}}
									onScroll={(e) => {
										if (highlightOverlayRef.current) {
											highlightOverlayRef.current.style.transform = `translateY(-${e.currentTarget.scrollTop}px)`;
										}
									}}
									onKeyDown={handleKeyDown}
									onPaste={handlePaste}
									placeholder={
										isLoading
											? "Type to queue next message..."
											: "Message... (/ commands, @ files)"
									}
									rows={1}
									aria-label="Message input"
									spellCheck
									autoCorrect="on"
									autoCapitalize="sentences"
									{...stylex.props(styles.textarea)}
									style={{
										minHeight: "20px",
										color: usePlainTextarea
											? colorValues.textMain
											: "transparent",
										caretColor: colorValues.textMain,
										WebkitTextFillColor: usePlainTextarea
											? colorValues.textMain
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
									size={10}
									{...stylex.props(
										styles.providerConfigChevron,
										agentConfigOpen && styles.providerConfigChevronOpen
									)}
								/>
							</button>
							{cwd && (
								<span {...stylex.props(styles.repoPill)} title={cwd}>
									/{folderLabel}
								</span>
							)}
							{cwd && gitBranch && (
								<ComposerBranchDropdown
									cwd={cwd}
									branch={gitBranch}
									onBranchChanged={onGitBranchChanged}
								/>
							)}
						</div>
					</div>
				</div>
			)}

			{agentConfigOpen &&
				createPortal(
					<div
						ref={agentConfigMenuRef}
						{...stylex.props(styles.providerConfigMenu)}
						style={{
							bottom: agentConfigPosition.bottom,
							left: agentConfigPosition.left,
							width: agentConfigPosition.width,
							maxHeight: agentConfigPosition.maxHeight,
						}}
					>
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
												styles.providerConfigChoiceActive
										)}
									>
										<span {...stylex.props(styles.shrink)}>{option.icon}</span>
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
												option.id === model && styles.providerConfigChoiceActive
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
													styles.providerConfigChoiceActive
											)}
										>
											<span>{option.label}</span>
										</button>
									))}
								</div>
							</div>
						)}
					</div>,
					document.body
				)}

			{mdPreview.show && (
				<div
					{...stylex.props(styles.modalBackdrop)}
					onClick={setMdPreview.bind(null, CLOSED_MD_PREVIEW)}
				>
					<div {...stylex.props(styles.modal)} onClick={stopPropagation}>
						<div {...stylex.props(styles.modalHeader)}>
							<span {...stylex.props(styles.modalTitle)}>{mdPreview.path}</span>
							<IconButton
								type="button"
								onClick={setMdPreview.bind(null, CLOSED_MD_PREVIEW)}
								variant="ghost"
								size="xs"
							>
								<IconX size={14} />
							</IconButton>
						</div>
						<div {...stylex.props(styles.modalBody)}>
							{mdPreview.loading && (
								<div {...stylex.props(styles.modalState)}>
									<span {...stylex.props(styles.modalStateText)}>
										Loading...
									</span>
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
}

const styles = stylex.create({
	hidden: {
		display: "none",
	},
	attachments: {
		display: "flex",
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._2,
		maxWidth: "100%",
		minWidth: 0,
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
		borderRadius: "999px",
		backgroundColor: "rgba(0, 0, 0, 0.7)",
		color: "#ffffff",
	},
	contextRail: {
		borderBottomColor: color.borderSubtle,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		boxSizing: "border-box",
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		maxWidth: "100%",
		minWidth: 0,
		overflow: "hidden",
		paddingBlock: controlSize._2,
		paddingInline: controlSize._2,
		width: "100%",
	},
	contextHeader: {
		alignItems: "center",
		display: "flex",
		gap: controlSize._2,
		justifyContent: "space-between",
		minWidth: 0,
	},
	contextTitle: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		textTransform: "uppercase",
	},
	contextClear: {
		backgroundColor: "transparent",
		borderWidth: 0,
		color: color.textMuted,
		cursor: "pointer",
		fontSize: font.size_1,
		padding: 0,
		":hover": {
			color: color.textMain,
		},
	},
	contextList: {
		boxSizing: "border-box",
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		maxWidth: "100%",
		minWidth: 0,
		overflow: "hidden",
		width: "100%",
	},
	contextBlock: {
		alignItems: "center",
		backgroundColor: color.surfaceSubtle,
		borderColor: color.borderSubtle,
		borderRadius: 8,
		borderStyle: "solid",
		borderWidth: 1,
		boxSizing: "border-box",
		display: "flex",
		flex: "0 1 auto",
		gap: controlSize._1,
		maxWidth: "100%",
		minWidth: 0,
		overflow: "hidden",
		paddingBlock: "0.1875rem",
		paddingInline: controlSize._1,
		width: "100%",
	},
	contextSource: {
		backgroundColor: color.accentWash,
		borderRadius: 6,
		color: color.accent,
		flexShrink: 0,
		fontSize: font.size_0_5,
		fontWeight: font.weight_5,
		paddingBlock: 1,
		paddingInline: controlSize._1,
		textTransform: "uppercase",
	},
	contextThumb: {
		borderColor: color.borderSubtle,
		borderRadius: 5,
		borderStyle: "solid",
		borderWidth: 1,
		flexShrink: 0,
		height: "1.375rem",
		objectFit: "cover",
		width: "1.375rem",
	},
	contextText: {
		color: color.textSoft,
		flex: "1 1 0",
		fontFamily: "var(--font-diff)",
		fontSize: font.size_1,
		maxWidth: "100%",
		minWidth: 0,
		overflow: "hidden",
		overflowWrap: "anywhere",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	fileMenu: {
		position: "absolute",
		left: 0,
		right: 0,
		bottom: "100%",
		zIndex: 9999,
		maxHeight: "300px",
		overflowY: "auto",
		marginBottom: controlSize._1,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: controlSize._2,
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.popoverDepth,
		boxShadow: shadow.popover,
	},
	menuHeader: {
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: 600,
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
		transitionDuration: "120ms",
		backgroundColor: {
			default: "transparent",
			":hover": color.controlHover,
		},
		backgroundImage: {
			default: "none",
			":hover": effect.controlDepth,
		},
	},
	fileMenuRowActive: {
		backgroundColor: color.controlActive,
		backgroundImage: effect.controlDepthHover,
	},
	fileMenuIcon: {
		flexShrink: 0,
		color: color.textMuted,
		fontSize: "0.6875rem",
	},
	fileMenuName: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.accent,
		fontFamily: "var(--font-diff)",
		fontSize: "0.6875rem",
		fontWeight: font.weight_5,
	},
	fileMenuPath: {
		minWidth: 0,
		flex: 1,
		overflow: "hidden",
		textAlign: "right",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontSize: font.size_1,
	},
	commandMenu: {
		position: "absolute",
		left: 0,
		right: 0,
		bottom: "100%",
		zIndex: 9999,
		maxHeight: "320px",
		overflow: "hidden",
		marginBottom: controlSize._2,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.lg,
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.popoverDepth,
		boxShadow: shadow.popover,
	},
	commandHeader: {
		color: color.textMuted,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		letterSpacing: "0.04em",
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
		textTransform: "uppercase",
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
			default: "transparent",
			":hover": color.controlHover,
		},
		backgroundImage: {
			default: "none",
			":hover": effect.controlDepth,
		},
	},
	commandRowActive: {
		backgroundColor: color.controlActive,
		backgroundImage: effect.controlDepthHover,
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
		minWidth: 0,
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
		paddingBlock: 1,
		paddingInline: controlSize._1,
		textTransform: "uppercase",
	},
	commandNameActive: {
		color: color.accent,
	},
	commandDescription: {
		color: color.textMuted,
		fontSize: "0.6875rem",
	},
	shrink: {
		flexShrink: 0,
	},
	modalBackdrop: {
		position: "absolute",
		inset: 0,
		zIndex: 50,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "rgba(0, 0, 0, 0.6)",
		backdropFilter: "blur(4px)",
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
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.popoverDepth,
		boxShadow: shadow.modal,
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
		minWidth: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontSize: "0.6875rem",
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
		boxSizing: "border-box",
		contain: "inline-size",
		flexShrink: 0,
		maxWidth: "100%",
		minWidth: 0,
		overflow: "visible",
		paddingBottom: controlSize._2,
		paddingInline: controlSize._3,
		paddingTop: controlSize._1,
		width: "100%",
	},
	inputFrame: {
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.controlDepth,
		borderColor: color.border,
		borderRadius: 12,
		borderStyle: "solid",
		borderWidth: 1,
		boxSizing: "border-box",
		contain: "inline-size",
		display: "flex",
		flexDirection: "column",
		isolation: "isolate",
		maxWidth: "100%",
		minWidth: 0,
		overflow: "visible",
		position: "relative",
		width: "100%",
		boxShadow: shadow.composerFrame,
		transitionProperty: "border-color, box-shadow, background-color",
		transitionDuration: "150ms",
	},
	repoPill: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.transparent,
		},
		backgroundImage: "none",
		borderColor: color.transparent,
		borderRadius: 6,
		borderStyle: "solid",
		borderWidth: 0,
		boxShadow: "none",
		boxSizing: "border-box",
		color: color.textSoft,
		display: "inline-flex",
		flexShrink: 0,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		height: controlSize._5,
		lineHeight: 1,
		maxWidth: "100%",
		minWidth: 0,
		paddingBlock: 0,
		paddingInline: controlSize._1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	accentText: {
		color: "currentColor",
	},
	providerConfigButton: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.transparent,
		},
		backgroundImage: "none",
		borderColor: color.transparent,
		borderRadius: 6,
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
		height: controlSize._5,
		lineHeight: 1,
		maxWidth: "100%",
		minWidth: 0,
		paddingBlock: 0,
		paddingInline: controlSize._1,
	},
	providerConfigLabel: {
		minWidth: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	providerConfigChevron: {
		color: color.textMuted,
		flexShrink: 0,
		transitionDuration: "150ms",
		transitionProperty: "transform",
	},
	providerConfigChevronOpen: {
		transform: "rotate(180deg)",
	},
	providerConfigMenu: {
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.popoverDepth,
		borderColor: color.border,
		borderRadius: 10,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.modal,
		boxSizing: "border-box",
		display: "flex",
		flexDirection: "column",
		gap: controlSize._3,
		overflowY: "auto",
		padding: controlSize._3,
		position: "fixed",
		zIndex: 220,
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
		borderRadius: 8,
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
		backgroundImage: effect.controlDepthHover,
		borderColor: color.borderStrong,
		boxShadow: shadow.selectedRing,
		color: color.textMain,
	},
	providerConfigError: {
		color: color.danger,
		fontSize: font.size_1,
		lineHeight: 1.35,
	},
	inputRow: {
		alignItems: "flex-end",
		boxSizing: "border-box",
		display: "flex",
		gap: controlSize._1,
		maxWidth: "100%",
		minWidth: 0,
		paddingBlock: "0.375rem",
		paddingLeft: controlSize._1,
		paddingRight: controlSize._3,
		width: "100%",
	},
	inputActions: {
		alignItems: "center",
		display: "flex",
		flexShrink: 0,
		gap: controlSize._0_5,
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
		minWidth: 0,
		overflow: "hidden",
		position: "relative",
	},
	highlightOverlay: {
		fontSize: "0.8125rem",
		left: 0,
		overflowWrap: "break-word",
		paddingRight: controlSize._8,
		pointerEvents: "none",
		position: "absolute",
		right: 0,
		top: 0,
		whiteSpace: "pre-wrap",
		wordBreak: "break-word",
	},
	textarea: {
		backgroundColor: "transparent",
		borderWidth: 0,
		boxShadow: "none",
		cursor: "text",
		display: "block",
		fontSize: "0.8125rem",
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
		boxSizing: "border-box",
		display: "flex",
		flexShrink: 0,
		gap: "0.375rem",
		maxWidth: "100%",
		minWidth: 0,
		overflowX: "auto",
		paddingBottom: "0.375rem",
		paddingInline: controlSize._2,
		userSelect: "none",
		width: "100%",
	},
});
