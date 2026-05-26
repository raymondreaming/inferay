import * as stylex from "@stylexjs/stylex";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	IconCheck,
	IconMessageCircle,
	IconSearch,
	IconTrash,
} from "../../components/ui/Icons.tsx";
import { isChatAgentKind } from "../../features/agents/agents.ts";
import { savePendingSend } from "../../features/chat/chat-session-store.ts";
import {
	createPendingAgentChatPane,
	DEFAULT_FONT_FAMILY,
	DEFAULT_FONT_SIZE,
	DEFAULT_OPACITY,
	getInitialGroups,
	loadTerminalState,
	saveTerminalState,
	type TerminalGroupModel,
} from "../../features/terminal/terminal-utils.ts";
import { useAsyncResource } from "../../hooks/useAsyncResource.ts";
import { DEFAULT_APP_ROUTE } from "../../lib/app-navigation.tsx";
import {
	loadAppThemeId,
	mapAppThemeToTerminalTheme,
} from "../../lib/app-theme.ts";
import { fetchJsonOr } from "../../lib/fetch-json.ts";
import { formatBytes } from "../../lib/format.ts";
import { setInputValue } from "../../lib/react-events.ts";
import { writeStoredValue } from "../../lib/stored-json.ts";
import { color, controlSize, font, radius } from "../../tokens.stylex.ts";

interface FileEntry {
	name: string;
	path: string;
	timestamp: number;
	size: number;
}

function formatAddedDate(timestamp: number): string {
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
	}).format(new Date(timestamp));
}

function selectedFiles(
	files: FileEntry[],
	selectedPaths: Set<string>
): FileEntry[] {
	return files.filter((file) => selectedPaths.has(file.path));
}

function buildFileChatMessage(files: FileEntry[]) {
	const displayText =
		files.length === 1
			? `Attached ${files[0]?.name ?? "file"}`
			: `Attached ${files.length} files`;
	return {
		displayText,
		fullText: `${displayText}\n\nHere are the images at these paths:\n${files
			.map((file) => file.path)
			.join("\n")}`,
	};
}

function ensureChatPaneId(): string | null {
	const existing = loadTerminalState();
	const groups = (existing?.groups ?? getInitialGroups()).map((group) => ({
		...group,
		panes: [...group.panes],
	}));
	const selectedGroupId = existing?.selectedGroupId ?? groups[0]?.id ?? null;
	const groupIndex = Math.max(
		0,
		groups.findIndex((group) => group.id === selectedGroupId)
	);
	const group = groups[groupIndex];
	if (!group) return null;

	let pane =
		group.panes.find(
			(candidate) =>
				candidate.id === group.selectedPaneId &&
				isChatAgentKind(candidate.agentKind)
		) ?? group.panes.find((candidate) => isChatAgentKind(candidate.agentKind));

	if (!pane) {
		pane = createPendingAgentChatPane();
		group.panes.unshift(pane);
	}
	group.selectedPaneId = pane.id;

	const nextGroups = groups.map(
		(candidate, index): TerminalGroupModel =>
			index === groupIndex ? group : candidate
	);

	saveTerminalState({
		groups: nextGroups,
		selectedGroupId: group.id,
		themeId: existing?.themeId ?? mapAppThemeToTerminalTheme(loadAppThemeId()),
		fontSize: existing?.fontSize ?? DEFAULT_FONT_SIZE,
		fontFamily: existing?.fontFamily ?? DEFAULT_FONT_FAMILY,
		opacity: existing?.opacity ?? DEFAULT_OPACITY,
	});

	return pane.id;
}

export function ImagesPage() {
	const navigate = useNavigate();
	const {
		data: files,
		setData: setFiles,
		loading,
	} = useAsyncResource<FileEntry[]>(
		() =>
			fetchJsonOr<{ images?: FileEntry[] }>("/api/images", {}).then(
				(d) => d.images ?? []
			),
		[],
		[]
	);
	const [query, setQuery] = useState("");
	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
		() => new Set()
	);

	const visibleFiles = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return files;
		return files.filter((file) => file.name.toLowerCase().includes(needle));
	}, [files, query]);

	const selected = useMemo(
		() => selectedFiles(files, selectedPaths),
		[files, selectedPaths]
	);
	const allVisibleSelected =
		visibleFiles.length > 0 &&
		visibleFiles.every((file) => selectedPaths.has(file.path));

	const toggleSelection = useCallback((file: FileEntry) => {
		setSelectedPaths((prev) => {
			const next = new Set(prev);
			if (next.has(file.path)) next.delete(file.path);
			else next.add(file.path);
			return next;
		});
	}, []);

	const toggleAllVisible = useCallback(() => {
		setSelectedPaths((prev) => {
			const next = new Set(prev);
			if (visibleFiles.every((file) => next.has(file.path))) {
				for (const file of visibleFiles) next.delete(file.path);
			} else {
				for (const file of visibleFiles) next.add(file.path);
			}
			return next;
		});
	}, [visibleFiles]);

	const deleteSelected = useCallback(async () => {
		if (selected.length === 0) return;
		const paths = selected.map((file) => file.path);
		await Promise.all(
			paths.map((path) =>
				fetch(`/api/delete-temp?path=${encodeURIComponent(path)}`, {
					method: "DELETE",
				}).catch(() => null)
			)
		);
		setFiles((prev) => prev.filter((file) => !paths.includes(file.path)));
		setSelectedPaths(new Set());
	}, [selected, setFiles]);

	const startChat = useCallback(() => {
		if (selected.length === 0) return;
		const paneId = ensureChatPaneId();
		if (!paneId) return;

		const { fullText } = buildFileChatMessage(selected);
		savePendingSend(paneId, fullText);
		writeStoredValue("terminal-main-view", "chat");
		window.dispatchEvent(new Event("terminal-shell-change"));
		navigate(DEFAULT_APP_ROUTE);
	}, [navigate, selected]);

	return (
		<div {...stylex.props(styles.root)}>
			<section {...stylex.props(styles.library)}>
				<div {...stylex.props(styles.topBar)}>
					<h1 {...stylex.props(styles.title)}>Files</h1>
					<label {...stylex.props(styles.searchBox)}>
						<IconSearch size={12} {...stylex.props(styles.searchIcon)} />
						<input
							type="search"
							value={query}
							onChange={setInputValue.bind(null, setQuery)}
							placeholder="Search files"
							{...stylex.props(styles.searchInput)}
						/>
					</label>
				</div>

				<div {...stylex.props(styles.actionBar)}>
					<button
						type="button"
						onClick={startChat}
						disabled={selected.length === 0}
						{...stylex.props(
							styles.actionButton,
							selected.length === 0
								? styles.actionButtonDisabled
								: styles.actionButtonPrimary
						)}
					>
						<IconMessageCircle size={13} />
						<span>Start chat</span>
					</button>
					<button
						type="button"
						onClick={deleteSelected}
						disabled={selected.length === 0}
						{...stylex.props(
							styles.actionButton,
							selected.length === 0
								? styles.actionButtonDisabled
								: styles.actionButtonDanger
						)}
					>
						<IconTrash size={13} />
						<span>Delete</span>
					</button>
					<div {...stylex.props(styles.selectionLabel)}>
						{selected.length === 1
							? "1 selected"
							: `${selected.length} selected`}
					</div>
				</div>

				<div {...stylex.props(styles.table)}>
					<div {...stylex.props(styles.tableHeader)}>
						<button
							type="button"
							onClick={toggleAllVisible}
							{...stylex.props(
								styles.checkBox,
								allVisibleSelected && styles.checkBoxChecked
							)}
							aria-label="Select all visible files"
						>
							{allVisibleSelected ? <IconCheck size={10} /> : null}
						</button>
						<span>Name</span>
						<span>Added</span>
						<span>Size</span>
					</div>

					<div {...stylex.props(styles.rows)}>
						{loading ? (
							<div {...stylex.props(styles.emptyState)}>Loading files...</div>
						) : visibleFiles.length === 0 ? (
							<div {...stylex.props(styles.emptyState)}>
								No files found. Attach an image in chat to add it here.
							</div>
						) : (
							visibleFiles.map((file) => {
								const isSelected = selectedPaths.has(file.path);
								return (
									<div
										key={file.path}
										{...stylex.props(
											styles.row,
											isSelected ? styles.rowSelected : styles.rowIdle
										)}
									>
										<button
											type="button"
											onClick={() => toggleSelection(file)}
											{...stylex.props(
												styles.checkBox,
												isSelected && styles.checkBoxChecked
											)}
											aria-label={`Select ${file.name}`}
										>
											{isSelected ? <IconCheck size={10} /> : null}
										</button>
										<button
											type="button"
											onClick={() => toggleSelection(file)}
											{...stylex.props(styles.nameCell)}
										>
											<span {...stylex.props(styles.thumbnailFrame)}>
												<img
													src={`/api/file?path=${encodeURIComponent(file.path)}`}
													alt=""
													{...stylex.props(styles.thumbnail)}
												/>
											</span>
											<span {...stylex.props(styles.fileName)}>
												{file.name}
											</span>
										</button>
										<span {...stylex.props(styles.metaCell)}>
											{formatAddedDate(file.timestamp)}
										</span>
										<span {...stylex.props(styles.metaCell)}>
											{formatBytes(file.size)}
										</span>
									</div>
								);
							})
						)}
					</div>
				</div>
			</section>
		</div>
	);
}

const styles = stylex.create({
	root: {
		backgroundColor: "#000",
		color: color.textMain,
		height: "100%",
		overflow: "hidden",
		paddingBlock: "3rem",
	},
	library: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._5,
		height: "100%",
		marginInline: "auto",
		maxWidth: 760,
		minWidth: 0,
		width: "min(760px, calc(100% - 4rem))",
	},
	topBar: {
		alignItems: "center",
		display: "flex",
		gap: controlSize._4,
		justifyContent: "space-between",
	},
	title: {
		color: "#fff",
		fontSize: "1.5rem",
		fontWeight: font.weight_6,
		letterSpacing: 0,
		lineHeight: 1,
		margin: 0,
	},
	searchBox: {
		alignItems: "center",
		backgroundColor: "rgba(255, 255, 255, 0.12)",
		borderColor: "rgba(255, 255, 255, 0.18)",
		borderRadius: 999,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		gap: controlSize._2,
		height: 34,
		paddingInline: controlSize._3,
		width: 216,
	},
	searchIcon: {
		color: color.textMuted,
		flexShrink: 0,
	},
	searchInput: {
		backgroundColor: "transparent",
		borderWidth: 0,
		color: color.textMain,
		flex: 1,
		fontSize: font.size_2,
		minWidth: 0,
		outline: "none",
		padding: 0,
		"::placeholder": {
			color: color.textMuted,
		},
	},
	actionBar: {
		alignItems: "center",
		display: "flex",
		gap: controlSize._2,
	},
	actionButton: {
		alignItems: "center",
		borderRadius: 999,
		borderStyle: "solid",
		borderWidth: 1,
		display: "inline-flex",
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		gap: controlSize._1_5,
		height: 32,
		paddingInline: controlSize._3,
		transitionDuration: "120ms",
		transitionProperty: "background-color, border-color, color",
	},
	actionButtonPrimary: {
		backgroundColor: "#fff",
		borderColor: "#fff",
		color: "#000",
	},
	actionButtonDanger: {
		backgroundColor: "transparent",
		borderColor: color.dangerBorder,
		color: color.danger,
	},
	actionButtonDisabled: {
		backgroundColor: "rgba(255, 255, 255, 0.08)",
		borderColor: "rgba(255, 255, 255, 0.1)",
		color: color.textMuted,
		cursor: "not-allowed",
	},
	selectionLabel: {
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		marginLeft: "auto",
	},
	table: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		minHeight: 0,
	},
	tableHeader: {
		alignItems: "center",
		color: color.textSoft,
		display: "grid",
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		gridTemplateColumns: "2.5rem minmax(0, 1fr) 10rem 8rem",
		height: 32,
		paddingInline: controlSize._1,
	},
	rows: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		minHeight: 0,
		overflowY: "auto",
		paddingBottom: controlSize._8,
		scrollbarWidth: "none",
		"::-webkit-scrollbar": {
			display: "none",
		},
	},
	row: {
		alignItems: "center",
		borderBottomColor: "rgba(255, 255, 255, 0.06)",
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "grid",
		gap: 0,
		gridTemplateColumns: "2.5rem minmax(0, 1fr) 10rem 8rem",
		minHeight: 58,
		paddingInline: controlSize._1,
		transitionDuration: "120ms",
		transitionProperty: "background-color, border-color",
	},
	rowIdle: {
		backgroundColor: {
			default: "transparent",
			":hover": "rgba(255, 255, 255, 0.05)",
		},
	},
	rowSelected: {
		backgroundColor: "rgba(255, 255, 255, 0.1)",
		borderRadius: radius.md,
		borderBottomColor: "transparent",
	},
	checkBox: {
		alignItems: "center",
		backgroundColor: "rgba(255, 255, 255, 0.08)",
		borderColor: "rgba(255, 255, 255, 0.22)",
		borderRadius: 4,
		borderStyle: "solid",
		borderWidth: 1,
		color: "#000",
		display: "flex",
		height: 16,
		justifyContent: "center",
		marginInline: "auto",
		padding: 0,
		width: 16,
	},
	checkBoxChecked: {
		backgroundColor: "#fff",
		borderColor: "#fff",
	},
	nameCell: {
		alignItems: "center",
		backgroundColor: "transparent",
		borderWidth: 0,
		color: color.textMain,
		display: "flex",
		gap: controlSize._3,
		minWidth: 0,
		padding: 0,
		textAlign: "left",
	},
	thumbnailFrame: {
		alignItems: "center",
		backgroundColor: "rgba(255, 255, 255, 0.1)",
		borderColor: "rgba(255, 255, 255, 0.18)",
		borderRadius: 6,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		flexShrink: 0,
		height: 30,
		justifyContent: "center",
		overflow: "hidden",
		width: 30,
	},
	thumbnail: {
		height: "100%",
		objectFit: "cover",
		width: "100%",
	},
	fileName: {
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	metaCell: {
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	emptyState: {
		alignItems: "center",
		color: color.textMuted,
		display: "flex",
		fontSize: font.size_2,
		height: 180,
		justifyContent: "center",
		textAlign: "center",
	},
});
