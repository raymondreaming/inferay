import * as stylex from "@octanejs/stylex";
import { useNavigate } from "@octanejs/tanstack-router";
import { useCallback, useMemo, useState } from "octane";
import { fetchJsonOr, postJson } from "../../../../adapters/backend/http.ts";
import { AGENT_MAIN_VIEW_STORAGE_KEY } from "../../../../adapters/storage/keys.ts";
import { writeStoredValue } from "../../../../adapters/storage/stored-values.ts";
import { DEFAULT_APP_ROUTE } from "../../../../app/model/navigation.tsx";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { useQueryResource } from "../../../../shared/hooks/useQueryResource.tsx";
import { formatBytes } from "../../../../shared/lib/format.ts";
import { setInputValue } from "../../../../shared/lib/react-events.ts";
import {
	IconCheck,
	IconMessageCircle,
	IconSearch,
	IconTrash,
} from "../../../../shared/ui/Icons/index.tsx";
import { savePendingSend } from "../../../conversation/model/chat-session-store.ts";
import {
	dispatchAgentShellChange,
	mutateAgentWorkspaceState,
} from "../../../workspace/model/workspace-model.ts";
import { styles } from "./styles.ts";

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
	});
	const [error, setError] = useState<string | null>(null);
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
		() => files.filter((file) => selectedPaths.has(file.path)),
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
		setError(null);
		try {
			const { text } = await postJson<{ text: string }>(
				"/api/images/chat-message",
				{ paths: selected.map((file) => file.path) },
			);
			const paneId = await ensureChatPaneId();
			if (!paneId) throw new Error("Could not open a chat");
			savePendingSend(paneId, text);
			writeStoredValue(AGENT_MAIN_VIEW_STORAGE_KEY, "chat");
			dispatchAgentShellChange({ source: "view", reason: "image-start-chat" });
			navigate({ to: DEFAULT_APP_ROUTE });
		} catch (error) {
			setError(error instanceof Error ? error.message : String(error));
		}
	}, [navigate, selected]);

	return (
		<div {...stylex.props(styles.root)}>
			<section {...stylex.props(styles.library)}>
				{error && <div role="alert">{error}</div>}
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
											{addedDateFormatter.format(new Date(file.timestamp))}
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
