import * as stylex from "@stylexjs/stylex";
import type React from "react";
import { useMemo, useRef } from "react";
import { getAgentIcon } from "../../features/agents/agent-ui.tsx";
import {
	CODEX_REASONING_LEVELS,
	getAgentDefinition,
} from "../../features/agents/agents.ts";
import type { AgentKind } from "../../features/terminal/terminal-utils.ts";
import { hasId } from "../../lib/data.ts";
import { setInputValue, stopPropagation } from "../../lib/react-events.ts";
import {
	color,
	colorValues,
	controlSize,
	font,
	motion,
	radius,
	shadow,
} from "../../tokens.stylex.ts";
import { DropdownButton } from "../ui/DropdownButton.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import {
	IconAlertTriangle,
	IconCheck,
	IconMic,
	IconPencil,
	IconPlus,
	IconStop,
	IconTrash,
	IconX,
} from "../ui/Icons.tsx";
import type {
	AttachedImageInfo,
	QueuedMessageInfo,
	SlashCommand,
} from "../../features/chat/agent-chat-shared.ts";
import { Markdown } from "./ChatRichContent.tsx";
import { renderInputHighlights } from "./chat-token-decorators.tsx";

type AgentOption = {
	id: AgentKind;
	label: string;
	icon: React.ReactNode;
};

const HIGHLIGHT_CHAR_LIMIT = 6000;
const CLOSED_MD_PREVIEW = {
	show: false,
	path: "",
	content: null,
	loading: false,
	error: null,
};

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
	queuedMessages,
	editingQueueId,
	setEditingQueueId,
	editingQueueText,
	setEditingQueueText,
	queueRef,
	setQueuedMessages,
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
	statusBar,
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
	input: string;
	setInput: (value: string) => void;
	isLoading: boolean;
	attachedImages: AttachedImageInfo[];
	removeAttachedImage: (path: string) => void;
	attachImage: (file: File) => Promise<void>;
	queuedMessages: QueuedMessageInfo[];
	editingQueueId: string | null;
	setEditingQueueId: (id: string | null) => void;
	editingQueueText: string;
	setEditingQueueText: (text: string) => void;
	queueRef: React.RefObject<QueuedMessageInfo[]>;
	setQueuedMessages: (messages: QueuedMessageInfo[]) => void;
	fileMenu: { show: boolean; selectedIdx: number; query: string };
	setFileMenu: React.Dispatch<
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
	fileResults: { name: string; path: string; isDir: boolean }[];
	selectFile: (idx: number) => void;
	slashMenu: { selectedIdx: number };
	setSlashMenu: React.Dispatch<
		React.SetStateAction<{
			show: boolean;
			selectedIdx: number;
			query: string;
			slashIndex: number;
		}>
	>;
	showCommands: boolean;
	filteredCommands: SlashCommand[];
	slashCommandNames: readonly string[];
	selectCommand: (idx: number) => void;
	handleInputForFileMenu: (value: string, cursorPos: number) => void;
	handleInputForSlashMenu: (value: string, cursorPos: number) => void;
	handleKeyDown: (e: React.KeyboardEvent) => void;
	handlePaste: (e: React.ClipboardEvent) => void;
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
	statusBar?: React.ReactNode;
	voiceInput?: {
		error: string | null;
		isListening: boolean;
		isSupported: boolean;
		onToggleListening: () => void;
	};
}) {
	const fileInputRef = useRef<HTMLInputElement>(null);
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
				...option,
				icon: getAgentIcon(agentKind, 12),
			})),
		[agentDefinition.models, agentKind]
	);
	const saveQueuedEdit = (id: string) => {
		const trimmed = editingQueueText.trim();
		if (trimmed) {
			const item = queueRef.current?.find(hasId.bind(null, id));
			if (item) {
				item.text = trimmed;
				item.displayText = trimmed;
			}
			setQueuedMessages([...(queueRef.current ?? [])]);
		}
		setEditingQueueId(null);
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

			{statusBar}

			{showInput && (
				<div {...stylex.props(styles.inputDock)}>
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
						{queuedMessages.length > 0 && (
							<div {...stylex.props(styles.queueList)}>
								{queuedMessages.map((qm, idx) => (
									<div key={qm.id} {...stylex.props(styles.queueRow)}>
										<span {...stylex.props(styles.queueIndex)}>{idx + 1}</span>
										{editingQueueId === qm.id ? (
											<div {...stylex.props(styles.queueEditRow)}>
												<input
													type="text"
													ref={(el) => el?.focus()}
													value={editingQueueText}
													onChange={setInputValue.bind(
														null,
														setEditingQueueText
													)}
													onKeyDown={(e) => {
														if (e.key === "Enter") {
															saveQueuedEdit(qm.id);
														} else if (e.key === "Escape") {
															setEditingQueueId(null);
														}
													}}
													{...stylex.props(styles.queueEditInput)}
												/>
												<IconButton
													type="button"
													onClick={() => saveQueuedEdit(qm.id)}
													variant="ghost"
													size="xs"
													className={stylex.props(styles.saveButton).className}
													title="Save"
												>
													<IconCheck size={11} />
												</IconButton>
												<IconButton
													type="button"
													onClick={() => setEditingQueueId(null)}
													variant="ghost"
													size="xs"
													title="Cancel"
												>
													<IconX size={11} />
												</IconButton>
											</div>
										) : (
											<>
												{qm.images && qm.images.length > 0 && (
													<img
														src={`/api/file?path=${encodeURIComponent(qm.images[0]!)}`}
														alt=""
														{...stylex.props(styles.queueImage)}
													/>
												)}
												<span {...stylex.props(styles.queueText)}>
													{qm.displayText}
												</span>
												<div {...stylex.props(styles.queueActions)}>
													<IconButton
														type="button"
														onClick={() => {
															setEditingQueueId(qm.id);
															setEditingQueueText(qm.text);
														}}
														variant="ghost"
														size="xs"
														title="Edit"
													>
														<IconPencil size={11} />
													</IconButton>
													<IconButton
														type="button"
														onClick={() => {
															const next = (queueRef.current ?? []).filter(
																(q) => q.id !== qm.id
															);
															if (queueRef.current) queueRef.current = next;
															setQueuedMessages([...next]);
															if (editingQueueId === qm.id) {
																setEditingQueueId(null);
															}
														}}
														variant="danger"
														size="xs"
														title="Remove from queue"
													>
														<IconTrash size={11} />
													</IconButton>
												</div>
											</>
										)}
									</div>
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
												!voiceInput.isListening &&
													voiceInput.error &&
													styles.voiceButtonError
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
								{isLoading && (
									<div {...stylex.props(styles.loadingDots)}>
										<span {...stylex.props(styles.loadingDot)} />
										<span
											{...stylex.props(styles.loadingDot, styles.loadingDot2)}
										/>
										<span
											{...stylex.props(styles.loadingDot, styles.loadingDot3)}
										/>
									</div>
								)}
							</div>
						</div>
						<div {...stylex.props(styles.pickerRow)}>
							<DropdownButton
								value={agentKind}
								options={agentKindOptions}
								onChange={(id) => onAgentKindChange(id as AgentKind)}
								icon={
									<span {...stylex.props(styles.accentText)}>
										{getAgentIcon(agentKind, 10)}
									</span>
								}
								minWidth={120}
								menuPlacement="top"
								buttonClassName={
									stylex.props(styles.pickerButtonAccent).className
								}
								labelClassName={stylex.props(styles.pickerLabel).className}
								renderOption={(opt, isOptionSelected) => (
									<div
										{...stylex.props(
											styles.agentOption,
											isOptionSelected && styles.agentOptionSelected
										)}
									>
										<span {...stylex.props(styles.shrink)}>{opt.icon}</span>
										<span {...stylex.props(styles.optionLabel)}>
											{opt.label}
										</span>
									</div>
								)}
							/>
							{agentDefinition.models.length > 0 && (
								<DropdownButton
									value={model}
									options={modelOptions}
									onChange={onModelChange}
									minWidth={190}
									menuPlacement="top"
									buttonClassName={
										stylex.props(styles.pickerButtonMuted).className
									}
									labelClassName={stylex.props(styles.modelLabel).className}
								/>
							)}
							{agentKind === "codex" && (
								<DropdownButton
									value={reasoningLevel}
									options={[...CODEX_REASONING_LEVELS]}
									onChange={onReasoningLevelChange}
									minWidth={150}
									menuPlacement="top"
									buttonClassName={
										stylex.props(styles.pickerButtonMuted).className
									}
									labelClassName={stylex.props(styles.reasoningLabel).className}
								/>
							)}
						</div>
					</div>
				</div>
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
		borderRadius: 8,
		display: "flex",
		gap: controlSize._2,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
		transitionProperty: "background-color",
		transitionDuration: "120ms",
		":hover": {
			backgroundColor: color.backgroundRaised,
		},
	},
	queueIndex: {
		alignItems: "center",
		backgroundColor: color.surfaceSubtle,
		borderRadius: 999,
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
		borderRadius: "0.25rem",
		backgroundColor: "rgba(255, 255, 255, 0.06)",
		color: color.textMain,
		fontSize: "0.6875rem",
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
		borderRadius: "0.25rem",
		objectFit: "cover",
	},
	queueText: {
		minWidth: 0,
		flex: 1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontSize: "0.6875rem",
	},
	queueActions: {
		display: "flex",
		flexShrink: 0,
		alignItems: "center",
		gap: "0.125rem",
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
		boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.6)",
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
	},
	fileMenuRowActive: {
		backgroundColor: color.accentWash,
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
		boxShadow: shadow.modal,
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
	loadingDots: {
		position: "absolute",
		right: 0,
		top: "50%",
		display: "flex",
		alignItems: "center",
		gap: "0.125rem",
		transform: "translateY(-50%)",
	},
	loadingDot: {
		width: controlSize._1,
		height: controlSize._1,
		borderRadius: "999px",
		backgroundColor: color.accent,
		animationName: stylex.keyframes({
			"50%": {
				opacity: 0.35,
			},
		}),
		animationDuration: "1s",
		animationIterationCount: "infinite",
	},
	loadingDot2: {
		animationDelay: "150ms",
	},
	loadingDot3: {
		animationDelay: "300ms",
	},
	accentText: {
		color: color.accent,
	},
	agentOption: {
		display: "flex",
		width: "100%",
		alignItems: "center",
		gap: controlSize._2,
		color: color.textMuted,
		fontSize: font.size_3,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
		textAlign: "left",
		transitionProperty: "background-color, color",
		transitionDuration: "120ms",
		backgroundColor: {
			default: "transparent",
			":hover": color.controlHover,
		},
		":hover": {
			color: color.textMain,
		},
	},
	agentOptionSelected: {
		backgroundColor: color.controlActive,
		color: color.textMain,
	},
	shrink: {
		flexShrink: 0,
	},
	optionLabel: {
		fontWeight: font.weight_5,
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
		borderRadius: 12,
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
		transitionDuration: "150ms",
	},
	pickerButtonAccent: {
		height: controlSize._5,
		borderRadius: 6,
		borderColor: "transparent",
		color: color.accent,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		gap: controlSize._1,
		paddingInline: controlSize._1,
		userSelect: "none",
		backgroundColor: {
			default: "transparent",
			":hover": color.accentWash,
		},
	},
	pickerButtonMuted: {
		height: controlSize._5,
		borderRadius: 6,
		borderColor: "transparent",
		color: color.textMuted,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		gap: controlSize._1,
		paddingInline: controlSize._1,
		userSelect: "none",
		backgroundColor: {
			default: "transparent",
			":hover": color.accentWash,
		},
	},
	pickerLabel: {
		fontSize: font.size_2,
	},
	modelLabel: {
		maxWidth: "96px",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		fontSize: font.size_2,
	},
	reasoningLabel: {
		maxWidth: "76px",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		fontSize: font.size_2,
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
		display: "flex",
		gap: "0.375rem",
		minWidth: 0,
		overflowX: "auto",
		paddingBottom: "0.375rem",
		paddingInline: controlSize._2,
		userSelect: "none",
	},
});
