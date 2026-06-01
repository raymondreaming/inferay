import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Markdown } from "../../components/chat/ChatRichContent.tsx";
import {
	IconCheck,
	IconCode,
	IconFilePlus,
	IconMessageCircle,
	IconSparkles,
	IconTrash,
} from "../../components/ui/Icons.tsx";
import {
	WorkspaceButton,
	WorkspaceEmptyState,
	WorkspacePage,
	WorkspaceSearch,
	WorkspaceSegmentButton,
	WorkspaceSegmentedControl,
	WorkspaceToolbar,
	WorkspaceToolbarSpacer,
} from "../../components/ui/WorkspacePage.tsx";
import { buildArtifactPreview } from "../../features/artifacts/artifact-preview.ts";
import {
	artifactContextBlock,
	artifactPromptDraft,
	DOCUMENT_ARTIFACTS_CHANGED_EVENT,
	DOCUMENT_ARTIFACTS_KEY,
	deleteLocalArtifact,
	filterArtifacts,
	loadArtifactWorkspace,
} from "../../features/artifacts/artifact-workspace-store.ts";
import type {
	ArtifactEntry,
	ArtifactKind,
	RepoDocArtifactSource,
} from "../../features/artifacts/types.ts";
import { saveStoredComposerContextBlocks } from "../../features/chat/chat-session-store.ts";
import { makeComposerContextBlock } from "../../features/chat/composer-context.ts";
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
import { TERMINAL_MAIN_VIEW_STORAGE_KEY } from "../../lib/client-storage-keys.ts";
import { CLIENT_STORAGE_CHANGED_EVENT } from "../../lib/client-storage-sync.ts";
import { fetchJsonOr, postJson } from "../../lib/fetch-json.ts";
import { formatBytes } from "../../lib/format.ts";
import { listenWindowEvent, setInputValue } from "../../lib/react-events.ts";
import {
	readStoredJson,
	writeStoredJson,
	writeStoredValue,
} from "../../lib/stored-json.ts";
import {
	color,
	controlSize,
	effect,
	font,
	radius,
	shadow,
} from "../../tokens.stylex.ts";

interface FileEntry {
	name: string;
	path: string;
	timestamp: number;
	size: number;
}

type RepoDocEntry = RepoDocArtifactSource;

const HIDDEN_ARTIFACTS_KEY = "inferay-hidden-artifacts";

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function fileEntries(value: unknown): FileEntry[] {
	return Array.isArray(value)
		? value.filter(
				(item): item is FileEntry =>
					typeof item === "object" &&
					item !== null &&
					typeof (item as FileEntry).name === "string" &&
					typeof (item as FileEntry).path === "string" &&
					typeof (item as FileEntry).timestamp === "number" &&
					typeof (item as FileEntry).size === "number"
			)
		: [];
}

function repoDocEntries(value: unknown): RepoDocEntry[] {
	return Array.isArray(value)
		? value.filter(
				(item): item is RepoDocEntry =>
					typeof item === "object" &&
					item !== null &&
					typeof (item as RepoDocEntry).path === "string" &&
					typeof (item as RepoDocEntry).relativePath === "string" &&
					typeof (item as RepoDocEntry).cwd === "string" &&
					typeof (item as RepoDocEntry).content === "string"
			)
		: [];
}

function formatAddedDate(timestamp: number): string {
	if (!Number.isFinite(timestamp) || timestamp <= 0) return "Unknown";
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
	}).format(new Date(timestamp));
}

function createArtifactChatPaneId(artifacts: ArtifactEntry[]): string | null {
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

	const pane = createPendingAgentChatPane();
	const contextBlocks = artifacts.map((artifact) =>
		makeComposerContextBlock(artifactContextBlock(artifact))
	);
	saveStoredComposerContextBlocks(pane.id, contextBlocks);
	group.panes.unshift(pane);
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

const KIND_FILTERS: readonly { id: ArtifactKind | "all"; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "image", label: "Images" },
	{ id: "document", label: "Docs" },
];

function ArtifactGlyph({ artifact }: { artifact: ArtifactEntry }) {
	if (artifact.kind === "image" && artifact.path) {
		return (
			<span {...stylex.props(styles.thumbnailFrame)}>
				<img
					src={`/api/file?path=${encodeURIComponent(artifact.path)}`}
					alt=""
					{...stylex.props(styles.thumbnail)}
				/>
			</span>
		);
	}
	return (
		<span {...stylex.props(styles.artifactGlyph)}>
			<IconFilePlus size={13} />
		</span>
	);
}

function ArtifactPreviewPanel({
	artifact,
}: {
	artifact: ArtifactEntry | null;
}) {
	const preview = useMemo(
		() => (artifact ? buildArtifactPreview(artifact) : null),
		[artifact]
	);
	if (!preview) {
		return (
			<aside {...stylex.props(styles.previewPanel, styles.previewEmpty)}>
				<IconFilePlus size={16} />
				<span>No preview</span>
			</aside>
		);
	}
	return (
		<aside {...stylex.props(styles.previewPanel)}>
			<div {...stylex.props(styles.previewHeader)}>
				<span {...stylex.props(styles.previewIcon)}>
					{preview.kind === "json" ? (
						<IconCode size={13} />
					) : (
						<IconFilePlus size={13} />
					)}
				</span>
				<span {...stylex.props(styles.previewTitleBlock)}>
					<span {...stylex.props(styles.previewTitle)}>{preview.title}</span>
					<span {...stylex.props(styles.previewSubtitle)}>
						{preview.subtitle}
					</span>
				</span>
				<span {...stylex.props(styles.previewKind)}>{preview.kind}</span>
			</div>
			<div {...stylex.props(styles.previewBody)}>
				{preview.kind === "image" && preview.imageUrl ? (
					<img
						src={preview.imageUrl}
						alt=""
						{...stylex.props(styles.previewImage)}
					/>
				) : preview.kind === "html" ? (
					<iframe
						title={preview.title}
						srcDoc={preview.content}
						sandbox=""
						{...stylex.props(styles.previewHtmlFrame)}
					/>
				) : preview.kind === "pdf" && preview.pdfUrl ? (
					<iframe
						title={preview.title}
						src={preview.pdfUrl}
						sandbox=""
						{...stylex.props(styles.previewPdfFrame)}
					/>
				) : preview.kind === "markdown" ? (
					<div {...stylex.props(styles.previewMarkdown)}>
						<Markdown text={preview.content} />
					</div>
				) : preview.kind === "json" && preview.tableRows.length > 0 ? (
					<div {...stylex.props(styles.jsonRows)}>
						{preview.tableRows.map((row) => (
							<div key={row.key} {...stylex.props(styles.jsonRow)}>
								<span {...stylex.props(styles.jsonKey)}>{row.key}</span>
								<pre {...stylex.props(styles.jsonValue)}>{row.value}</pre>
							</div>
						))}
					</div>
				) : (
					<pre {...stylex.props(styles.previewCode)}>
						{preview.lines.join("\n")}
					</pre>
				)}
			</div>
		</aside>
	);
}

export function ImagesPage() {
	const navigate = useNavigate();
	const [watchedDirs] = useState<string[]>(() =>
		stringArray(readStoredJson<unknown>("git-watched-dirs", []))
	);
	const {
		data: files,
		setData: setFiles,
		loading: imagesLoading,
	} = useAsyncResource<FileEntry[]>(
		() =>
			fetchJsonOr<{ images?: FileEntry[] }>("/api/images", {}).then((d) =>
				fileEntries(d.images)
			),
		[],
		[]
	);
	const { data: repoDocs, loading: repoDocsLoading } = useAsyncResource<
		RepoDocEntry[]
	>(
		() => {
			if (watchedDirs.length === 0) return Promise.resolve([]);
			return Promise.all(
				watchedDirs.map((cwd) =>
					fetchJsonOr<{ docs?: RepoDocEntry[] }>(
						`/api/files/repo-docs?cwd=${encodeURIComponent(cwd)}`,
						{}
					).then((result) => repoDocEntries(result.docs))
				)
			).then((groups) => {
				const docs: RepoDocEntry[] = [];
				for (const group of groups) docs.push(...group);
				return docs;
			});
		},
		[],
		[watchedDirs]
	);
	const loading = imagesLoading || repoDocsLoading;
	const [query, setQuery] = useState("");
	const [kindFilter, setKindFilter] = useState<ArtifactKind | "all">("all");
	const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
	const [focusedArtifactId, setFocusedArtifactId] = useState<string | null>(
		null
	);
	const [artifactVersion, setArtifactVersion] = useState(0);
	const [hiddenArtifactIds, setHiddenArtifactIds] = useState<Set<string>>(
		() =>
			new Set(stringArray(readStoredJson<unknown>(HIDDEN_ARTIFACTS_KEY, [])))
	);
	useEffect(() => {
		const refreshArtifacts = () => setArtifactVersion((version) => version + 1);
		const stopLocal = listenWindowEvent(
			DOCUMENT_ARTIFACTS_CHANGED_EVENT,
			refreshArtifacts
		);
		const stopSynced = listenWindowEvent(
			CLIENT_STORAGE_CHANGED_EVENT,
			(event) => {
				const key = (event as CustomEvent<{ key?: string }>).detail?.key;
				if (key === DOCUMENT_ARTIFACTS_KEY) refreshArtifacts();
			}
		);
		const stopStorage = listenWindowEvent("storage", (event) => {
			if (event.key === DOCUMENT_ARTIFACTS_KEY) refreshArtifacts();
		});
		return () => {
			stopLocal();
			stopSynced();
			stopStorage();
		};
	}, []);
	const allArtifacts = useMemo(() => {
		void artifactVersion;
		return loadArtifactWorkspace(files, repoDocs);
	}, [artifactVersion, files, repoDocs]);
	const artifacts = useMemo(
		() =>
			allArtifacts.filter((artifact) => !hiddenArtifactIds.has(artifact.id)),
		[allArtifacts, hiddenArtifactIds]
	);

	const visibleArtifacts = useMemo(
		() => filterArtifacts(artifacts, kindFilter, query),
		[artifacts, kindFilter, query]
	);

	const selected = useMemo(
		() => artifacts.filter((artifact) => selectedIds.has(artifact.id)),
		[artifacts, selectedIds]
	);
	const allVisibleSelected =
		visibleArtifacts.length > 0 &&
		visibleArtifacts.every((artifact) => selectedIds.has(artifact.id));
	const focusedArtifact = useMemo(
		() =>
			visibleArtifacts.find((artifact) => artifact.id === focusedArtifactId) ??
			selected[0] ??
			visibleArtifacts[0] ??
			null,
		[focusedArtifactId, selected, visibleArtifacts]
	);

	const toggleSelection = useCallback((artifact: ArtifactEntry) => {
		setFocusedArtifactId(artifact.id);
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(artifact.id)) next.delete(artifact.id);
			else next.add(artifact.id);
			return next;
		});
	}, []);

	const toggleAllVisible = useCallback(() => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (visibleArtifacts.every((artifact) => next.has(artifact.id))) {
				for (const artifact of visibleArtifacts) next.delete(artifact.id);
			} else {
				for (const artifact of visibleArtifacts) next.add(artifact.id);
			}
			return next;
		});
	}, [visibleArtifacts]);

	const deleteSelected = useCallback(async () => {
		if (selected.length === 0) return;
		const deletable = selected.filter((artifact) => artifact.deletable);
		const paths = deletable
			.filter((artifact) => artifact.kind === "image" && artifact.path)
			.map((artifact) => artifact.path!);
		await Promise.all(
			paths.map((path) =>
				fetch(`/api/delete-temp?path=${encodeURIComponent(path)}`, {
					method: "DELETE",
				}).catch(() => null)
			)
		);
		for (const artifact of deletable) deleteLocalArtifact(artifact.id);
		setHiddenArtifactIds((prev) => {
			const next = new Set(prev);
			for (const artifact of selected) next.add(artifact.id);
			writeStoredJson(HIDDEN_ARTIFACTS_KEY, [...next]);
			return next;
		});
		setFiles((prev) => prev.filter((file) => !paths.includes(file.path)));
		setSelectedIds(new Set());
		setFocusedArtifactId(null);
	}, [selected, setFiles]);

	const canDeleteSelected = selected.length > 0;

	const startChatWithArtifacts = useCallback(
		(artifactsToAttach: ArtifactEntry[]) => {
			if (artifactsToAttach.length === 0) return;
			const paneId = createArtifactChatPaneId(artifactsToAttach);
			if (!paneId) return;

			writeStoredValue(TERMINAL_MAIN_VIEW_STORAGE_KEY, "chat");
			window.dispatchEvent(new Event("terminal-shell-change"));
			navigate(DEFAULT_APP_ROUTE);
		},
		[navigate]
	);

	const startChat = useCallback(() => {
		if (selected.length === 0) return;
		const paneId = createArtifactChatPaneId(selected);
		if (!paneId) return;

		writeStoredValue(TERMINAL_MAIN_VIEW_STORAGE_KEY, "chat");
		window.dispatchEvent(new Event("terminal-shell-change"));
		navigate(DEFAULT_APP_ROUTE);
	}, [navigate, selected]);

	const createPromptFromFocusedArtifact = useCallback(async () => {
		if (!focusedArtifact) return;
		try {
			const draft = artifactPromptDraft(focusedArtifact);
			await postJson("/api/prompts", draft);
		} catch (error) {
			console.error(error);
		}
	}, [focusedArtifact]);

	return (
		<WorkspacePage>
			<WorkspaceToolbar>
				<WorkspaceSegmentedControl {...stylex.props(styles.toolbarFilters)}>
					{KIND_FILTERS.map((filter) => (
						<WorkspaceSegmentButton
							key={filter.id}
							type="button"
							onClick={() => setKindFilter(filter.id)}
							active={kindFilter === filter.id}
						>
							{filter.label}
						</WorkspaceSegmentButton>
					))}
				</WorkspaceSegmentedControl>
				<WorkspaceToolbarSpacer />
				<WorkspaceSearch
					width="lg"
					value={query}
					onChange={setInputValue.bind(null, setQuery)}
					placeholder="Search artifacts"
				/>
				<WorkspaceButton
					type="button"
					onClick={startChat}
					disabled={selected.length === 0}
					variant="primary"
				>
					<IconMessageCircle size={13} />
					{selected.length > 0
						? `Start chat (${selected.length})`
						: "Start chat"}
				</WorkspaceButton>
				<WorkspaceButton
					type="button"
					onClick={createPromptFromFocusedArtifact}
					disabled={!focusedArtifact}
					variant="secondary"
				>
					<IconSparkles size={13} />
					Make prompt
				</WorkspaceButton>
				<WorkspaceButton
					type="button"
					onClick={deleteSelected}
					disabled={!canDeleteSelected}
					variant="ghost"
				>
					<IconTrash size={13} />
					Delete
				</WorkspaceButton>
			</WorkspaceToolbar>
			<section {...stylex.props(styles.library)}>
				<div {...stylex.props(styles.contentGrid)}>
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
							<span>Kind</span>
							<span>Added</span>
							<span>Size</span>
							<span />
						</div>

						<div {...stylex.props(styles.rows)}>
							{loading ? (
								<WorkspaceEmptyState
									icon={<IconFilePlus size={16} />}
									title="Loading artifacts"
									description="Indexing saved images and docs."
								/>
							) : visibleArtifacts.length === 0 ? (
								<WorkspaceEmptyState
									icon={<IconFilePlus size={16} />}
									title="No artifacts found"
									description={
										query.trim()
											? "No saved artifact matches this search or filter."
											: "Attach an image or save a doc to add it here."
									}
								/>
							) : (
								visibleArtifacts.map((artifact) => {
									const isSelected = selectedIds.has(artifact.id);
									const isFocused = focusedArtifact?.id === artifact.id;
									return (
										<div
											key={artifact.id}
											onClick={() => toggleSelection(artifact)}
											{...stylex.props(
												styles.row,
												isFocused
													? styles.rowFocused
													: isSelected
														? styles.rowSelected
														: styles.rowIdle
											)}
										>
											<button
												type="button"
												onClick={(event) => {
													event.stopPropagation();
													toggleSelection(artifact);
												}}
												{...stylex.props(
													styles.checkBox,
													isSelected && styles.checkBoxChecked
												)}
												aria-label={`Select ${artifact.title}`}
											>
												{isSelected ? <IconCheck size={10} /> : null}
											</button>
											<button
												type="button"
												onClick={() => toggleSelection(artifact)}
												{...stylex.props(styles.nameCell)}
											>
												<ArtifactGlyph artifact={artifact} />
												<span {...stylex.props(styles.fileText)}>
													<span {...stylex.props(styles.fileName)}>
														{artifact.title}
													</span>
													<span {...stylex.props(styles.filePreview)}>
														{artifact.preview}
													</span>
												</span>
											</button>
											<span {...stylex.props(styles.kindPill)}>
												{artifact.kind}
											</span>
											<span {...stylex.props(styles.metaCell)}>
												{formatAddedDate(artifact.updatedAt)}
											</span>
											<span {...stylex.props(styles.metaCell)}>
												{artifact.size === null
													? "text"
													: formatBytes(artifact.size)}
											</span>
											<span {...stylex.props(styles.rowActionCell)}>
												{isSelected ? (
													<button
														type="button"
														onClick={(event) => {
															event.stopPropagation();
															startChatWithArtifacts([artifact]);
														}}
														{...stylex.props(styles.rowStartChatButton)}
													>
														<IconMessageCircle size={12} />
														Start chat
													</button>
												) : null}
											</span>
										</div>
									);
								})
							)}
						</div>
					</div>
					<ArtifactPreviewPanel artifact={focusedArtifact} />
				</div>
			</section>
		</WorkspacePage>
	);
}

const styles = stylex.create({
	library: {
		display: "flex",
		flexDirection: "column",
		flex: 1,
		gap: controlSize._3,
		height: "100%",
		minWidth: 0,
		overflow: "hidden",
		padding: controlSize._4,
	},
	toolbarFilters: {
		marginLeft: controlSize._2,
	},
	contentGrid: {
		display: "grid",
		flex: 1,
		gap: controlSize._4,
		gridTemplateColumns: {
			default: "minmax(0, 1fr)",
			"@media (min-width: 920px)": "minmax(0, 1fr) minmax(17rem, 22rem)",
		},
		minHeight: 0,
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
		gridTemplateColumns: "2.5rem minmax(0, 1fr) 6rem 10rem 8rem 7rem",
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
		borderBottomColor: color.borderSubtle,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "grid",
		gap: 0,
		gridTemplateColumns: "2.5rem minmax(0, 1fr) 6rem 10rem 8rem 7rem",
		minHeight: 58,
		paddingInline: controlSize._1,
		transitionDuration: "120ms",
		transitionProperty: "background-color, background-image, border-color",
	},
	rowIdle: {
		backgroundColor: {
			default: "transparent",
			":hover": color.surfaceControl,
		},
		backgroundImage: {
			default: "none",
			":hover": effect.controlDepth,
		},
	},
	rowSelected: {
		backgroundColor: color.surfaceControl,
		backgroundImage: effect.controlDepth,
		borderRadius: radius.md,
		borderBottomColor: "transparent",
	},
	rowFocused: {
		backgroundColor: color.surfaceControlHover,
		backgroundImage: effect.controlDepthHover,
		borderRadius: radius.md,
		borderBottomColor: "transparent",
	},
	checkBox: {
		alignItems: "center",
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.controlDepth,
		borderColor: color.borderControl,
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
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.controlDepth,
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.controlDepth,
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
	artifactGlyph: {
		alignItems: "center",
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.controlDepth,
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.controlDepth,
		color: color.textSoft,
		display: "flex",
		flexShrink: 0,
		height: 30,
		justifyContent: "center",
		width: 30,
	},
	fileText: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._0_5,
		minWidth: 0,
	},
	fileName: {
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	filePreview: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	kindPill: {
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.controlDepth,
		borderColor: color.border,
		borderRadius: radius.pill,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		justifySelf: "start",
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._2,
		textTransform: "capitalize",
	},
	metaCell: {
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	rowActionCell: {
		alignItems: "center",
		display: "flex",
		justifyContent: "flex-end",
		minWidth: 0,
	},
	rowStartChatButton: {
		alignItems: "center",
		backgroundColor: {
			default: color.surfaceControl,
			":hover": color.surfaceControlHover,
		},
		backgroundImage: {
			default: effect.controlDepth,
			":hover": effect.controlDepthHover,
		},
		borderColor: color.borderStrong,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textMain,
		display: "inline-flex",
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		gap: controlSize._1,
		height: controlSize._6,
		paddingInline: controlSize._2,
		whiteSpace: "nowrap",
	},
	previewPanel: {
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.controlDepth,
		borderColor: color.border,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.controlDepth,
		display: "flex",
		flexDirection: "column",
		maxHeight: {
			default: 260,
			"@media (min-width: 920px)": "none",
		},
		minHeight: 0,
		overflow: "hidden",
	},
	previewEmpty: {
		alignItems: "center",
		color: color.textMuted,
		fontSize: font.size_2,
		gap: controlSize._2,
		justifyContent: "center",
	},
	previewHeader: {
		alignItems: "center",
		borderBottomColor: color.borderSubtle,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "flex",
		gap: controlSize._2,
		minHeight: 52,
		paddingInline: controlSize._3,
	},
	previewIcon: {
		alignItems: "center",
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.controlDepth,
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.controlDepth,
		color: color.textSoft,
		display: "inline-flex",
		height: 28,
		justifyContent: "center",
		width: 28,
	},
	previewTitleBlock: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		minWidth: 0,
	},
	previewTitle: {
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	previewSubtitle: {
		color: color.textMuted,
		fontSize: font.size_1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	previewKind: {
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.controlDepth,
		borderColor: color.border,
		borderRadius: radius.pill,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._2,
		textTransform: "capitalize",
	},
	previewBody: {
		flex: 1,
		minHeight: 0,
		overflow: "auto",
		padding: controlSize._3,
	},
	previewImage: {
		backgroundColor: color.background,
		borderRadius: radius.md,
		display: "block",
		maxHeight: "100%",
		maxWidth: "100%",
		objectFit: "contain",
		width: "100%",
	},
	previewHtmlFrame: {
		backgroundColor: "#fff",
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		display: "block",
		height: "100%",
		minHeight: 260,
		width: "100%",
	},
	previewPdfFrame: {
		backgroundColor: "#fff",
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		display: "block",
		height: "100%",
		minHeight: 360,
		width: "100%",
	},
	previewMarkdown: {
		color: color.textMain,
		fontSize: font.size_2,
	},
	previewCode: {
		color: color.textSoft,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		lineHeight: 1.55,
		margin: 0,
		overflow: "visible",
		whiteSpace: "pre-wrap",
		wordBreak: "break-word",
	},
	jsonRows: {
		display: "grid",
		gap: controlSize._1,
	},
	jsonRow: {
		borderBottomColor: "rgba(255, 255, 255, 0.08)",
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "grid",
		gap: controlSize._1,
		gridTemplateColumns: "minmax(4rem, 0.35fr) minmax(0, 1fr)",
		paddingBottom: controlSize._1,
	},
	jsonKey: {
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	jsonValue: {
		color: color.textSoft,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		margin: 0,
		whiteSpace: "pre-wrap",
		wordBreak: "break-word",
	},
});
