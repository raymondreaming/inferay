import * as stylex from "@octanejs/stylex";
import { createFileRoute, useNavigate } from "@octanejs/tanstack-router";
import { useCallback, useMemo, useState } from "octane";
import { fetchJsonOr } from "../../adapters/backend/http.ts";
import { AGENT_MAIN_VIEW_STORAGE_KEY } from "../../adapters/storage/keys.ts";
import { writeStoredValue } from "../../adapters/storage/stored-values.ts";
import { DEFAULT_APP_ROUTE } from "../../app/model/navigation.tsx";
import { iconSize } from "../../design-system.ts";
import { savePendingSend } from "../../modules/conversation/model/chat-session-store.ts";
import {
	dispatchAgentShellChange,
	mutateAgentWorkspaceState,
} from "../../modules/workspace/model/workspace-model.ts";
import { useQueryResource } from "../../shared/hooks/useQueryResource.tsx";
import { formatBytes } from "../../shared/lib/format.ts";
import { setInputValue } from "../../shared/lib/react-events.ts";
import {
	IconCheck,
	IconMessageCircle,
	IconSearch,
	IconTrash,
} from "../../shared/ui/Icons.tsx";
import {
	color,
	controlSize,
	font,
	motion,
	palette,
	radius,
} from "../../tokens.stylex.ts";

export const Route = createFileRoute("/_app/images")({ component: ImagesPage });

interface FileEntry {
	name: string;
	path: string;
	timestamp: number;
	size: number;
}

const addedDateFormatter = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
});

function formatAddedDate(timestamp: number): string {
	return addedDateFormatter.format(new Date(timestamp));
}

function selectedFiles(
	files: FileEntry[],
	selectedPaths: Set<string>,
): FileEntry[] {
	return files.filter((file) => selectedPaths.has(file.path));
}

function areImageFilesEqual(prev: FileEntry[], next: FileEntry[]) {
	if (prev.length !== next.length) return false;
	for (let i = 0; i < prev.length; i++) {
		const a = prev[i]!;
		const b = next[i]!;
		if (
			a.name !== b.name ||
			a.path !== b.path ||
			a.timestamp !== b.timestamp ||
			a.size !== b.size
		) {
			return false;
		}
	}
	return true;
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

async function ensureChatPaneId(): Promise<string | null> {
	const next = await mutateAgentWorkspaceState(
		{ type: "ensureChatPane" },
		"image-chat-pane",
		{ createIfMissing: true },
	);
	const group = next?.groups.find((item) => item.id === next.selectedGroupId);
	return group?.selectedPaneId ?? null;
}

export function ImagesPage() {
	const navigate = useNavigate();
	const fetchImageFiles = useCallback(
		() =>
			fetchJsonOr<{ images?: FileEntry[] }>("/api/images", {}).then(
				(d) => d.images ?? [],
			),
		[],
	);
	const {
		data: files,
		setData: setFiles,
		loading,
	} = useQueryResource<FileEntry[]>(fetchImageFiles, [], {
		queryKey: ["files", "images"],
		isEqual: areImageFilesEqual,
	});
	const [query, setQuery] = useState("");
	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
		() => new Set(),
	);

	const visibleFiles = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return files;
		return files.filter((file) => file.name.toLowerCase().includes(needle));
	}, [files, query]);

	const selected = useMemo(
		() => selectedFiles(files, selectedPaths),
		[files, selectedPaths],
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
				}).catch(() => null),
			),
		);
		setFiles((prev) => prev.filter((file) => !paths.includes(file.path)));
		setSelectedPaths(new Set());
	}, [selected, setFiles]);

	const startChat = useCallback(async () => {
		if (selected.length === 0) return;
		const paneId = await ensureChatPaneId();
		if (!paneId) return;

		const { fullText } = buildFileChatMessage(selected);
		savePendingSend(paneId, fullText);
		writeStoredValue(AGENT_MAIN_VIEW_STORAGE_KEY, "chat");
		dispatchAgentShellChange({ source: "view", reason: "image-start-chat" });
		navigate({ to: DEFAULT_APP_ROUTE });
	}, [navigate, selected]);

	return (
		<div {...stylex.props(styles.root)}>
			<section {...stylex.props(styles.library)}>
				<div {...stylex.props(styles.topBar)}>
					<h1 {...stylex.props(styles.title)}>Files</h1>
					<label {...stylex.props(styles.searchBox)}>
						<IconSearch
							size={iconSize.md}
							{...stylex.props(styles.searchIcon)}
						/>
						<input
							type="search"
							value={query}
							onInput={setInputValue.bind(null, setQuery)}
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
								: styles.actionButtonPrimary,
						)}
					>
						<IconMessageCircle size={iconSize._2md} />
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
								: styles.actionButtonDanger,
						)}
					>
						<IconTrash size={iconSize._2md} />
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
								allVisibleSelected && styles.checkBoxChecked,
							)}
							aria-label="Select all visible files"
						>
							{allVisibleSelected ? <IconCheck size={iconSize.sm} /> : null}
						</button>
						<span>Name</span>
						<span>Added</span>
						<span>Size</span>
					</div>

					<div {...stylex.props(styles.rows)}>
						{loading ? (
							<div {...stylex.props(styles.emptyState)}>Loading files…</div>
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
											isSelected ? styles.rowSelected : styles.rowIdle,
										)}
									>
										<button
											type="button"
											onClick={() => toggleSelection(file)}
											{...stylex.props(
												styles.checkBox,
												isSelected && styles.checkBoxChecked,
											)}
											aria-label={`Select ${file.name}`}
										>
											{isSelected ? <IconCheck size={iconSize.sm} /> : null}
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
		backgroundColor: color.transparent,
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
		minWidth: controlSize._0,
		width: "min(760px, calc(100% - 4rem))",
	},
	topBar: {
		alignItems: "center",
		display: "flex",
		gap: controlSize._4,
		justifyContent: "space-between",
	},
	title: {
		color: palette.white,
		fontSize: font.size_9,
		fontWeight: font.weight_6,
		letterSpacing: 0,
		lineHeight: 1,
		margin: controlSize._0,
	},
	searchBox: {
		alignItems: "center",
		backgroundColor: color.surfaceWhite12,
		borderColor: color.surfaceWhite18,
		borderRadius: radius.pill,
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
		backgroundColor: color.transparent,
		borderWidth: 0,
		color: color.textMain,
		flex: 1,
		fontSize: font.size_2,
		minWidth: controlSize._0,
		outline: "none",
		padding: controlSize._0,
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
		borderRadius: radius.pill,
		borderStyle: "solid",
		borderWidth: 1,
		display: "inline-flex",
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		gap: controlSize._1_5,
		height: controlSize._8,
		paddingInline: controlSize._3,
		transitionDuration: motion.durationFast,
		transitionProperty: "background-color, border-color, color",
	},
	actionButtonPrimary: {
		backgroundColor: palette.white,
		borderColor: palette.white,
		color: palette.black,
	},
	actionButtonDanger: {
		backgroundColor: color.transparent,
		borderColor: color.dangerBorder,
		color: color.danger,
	},
	actionButtonDisabled: {
		backgroundColor: color.surfaceWhite08,
		borderColor: color.surfaceWhite10,
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
		minHeight: controlSize._0,
	},
	tableHeader: {
		alignItems: "center",
		color: color.textSoft,
		display: "grid",
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		gridTemplateColumns: "2.5rem minmax(0, 1fr) 10rem 8rem",
		height: controlSize._8,
		paddingInline: controlSize._1,
	},
	rows: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		minHeight: controlSize._0,
		overflowY: "auto",
		paddingBottom: controlSize._8,
		scrollbarWidth: "none",
		"::-webkit-scrollbar": {
			display: "none",
		},
	},
	row: {
		alignItems: "center",
		borderBottomColor: color.surfaceWhite06,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "grid",
		gap: controlSize._0,
		gridTemplateColumns: "2.5rem minmax(0, 1fr) 10rem 8rem",
		minHeight: 58,
		paddingInline: controlSize._1,
		transitionDuration: motion.durationFast,
		transitionProperty: "background-color, border-color",
	},
	rowIdle: {
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceWhite05,
		},
	},
	rowSelected: {
		backgroundColor: color.surfaceWhite10,
		borderRadius: radius.md,
		borderBottomColor: color.transparent,
	},
	checkBox: {
		alignItems: "center",
		backgroundColor: color.surfaceWhite08,
		borderColor: color.surfaceWhite22,
		borderRadius: radius.sm,
		borderStyle: "solid",
		borderWidth: 1,
		color: palette.black,
		display: "flex",
		height: controlSize._4,
		justifyContent: "center",
		marginInline: "auto",
		padding: controlSize._0,
		width: controlSize._4,
	},
	checkBoxChecked: {
		backgroundColor: palette.white,
		borderColor: palette.white,
	},
	nameCell: {
		alignItems: "center",
		backgroundColor: color.transparent,
		borderWidth: 0,
		color: color.textMain,
		display: "flex",
		gap: controlSize._3,
		minWidth: controlSize._0,
		padding: controlSize._0,
		textAlign: "left",
	},
	thumbnailFrame: {
		alignItems: "center",
		backgroundColor: color.surfaceWhite10,
		borderColor: color.surfaceWhite18,
		borderRadius: radius.md,
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
