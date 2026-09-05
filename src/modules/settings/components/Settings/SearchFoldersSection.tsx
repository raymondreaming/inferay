import * as stylex from "@octanejs/stylex";
import { useCallback, useMemo, useRef, useState } from "octane";
import { fetchJsonOr } from "../../../../adapters/backend/http.ts";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { useQueryResource } from "../../../../shared/hooks/useQueryResource.tsx";
import { setInputValue } from "../../../../shared/lib/react-events.ts";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import { IconButton } from "../../../../shared/ui/IconButton/index.tsx";
import {
	IconFolder,
	IconPlus,
	IconX,
} from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";

const EMPTY_FOLDERS: string[] = [];

function areLoadedFoldersEqual(prev: string[] | null, next: string[] | null) {
	if (prev === next) return true;
	if (!prev || !next || prev.length !== next.length) return false;
	for (let i = 0; i < prev.length; i++) {
		if (prev[i] !== next[i]) return false;
	}
	return true;
}

export function SearchFoldersSection({
	contained = false,
}: {
	contained?: boolean;
}) {
	const fetchSearchFolders = useCallback(async () => {
		const data = await fetchJsonOr<{ folders: string[] }>(
			"/api/config/search-folders",
			{ folders: [] },
		);
		return data.folders;
	}, []);
	const { data: loadedFolders, setData: setFolders } = useQueryResource<
		string[] | null
	>(fetchSearchFolders, null, {
		queryKey: ["agent", "search-folders"],
		isEqual: areLoadedFoldersEqual,
	});
	const folders = useMemo(
		() => loadedFolders ?? EMPTY_FOLDERS,
		[loadedFolders],
	);
	const [newFolder, setNewFolder] = useState("");
	const inputRef = useRef<HTMLInputElement | null>(null);

	const saveFolders = useCallback(
		async (next: string[]) => {
			setFolders(next);
			await fetch("/api/config/search-folders", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ folders: next }),
			});
		},
		[setFolders],
	);

	const addFolder = useCallback(() => {
		const trimmed = newFolder.trim();
		if (!trimmed || folders.includes(trimmed)) return;
		saveFolders([...folders, trimmed]);
		setNewFolder("");
		inputRef.current?.focus();
	}, [newFolder, folders, saveFolders]);

	const removeFolder = useCallback(
		(idx: number) => {
			saveFolders(folders.filter((_, i) => i !== idx));
		},
		[folders, saveFolders],
	);

	const browseFolder = useCallback(async () => {
		try {
			const { folder } = await fetchJsonOr<{ folder: string | null }>(
				"/api/config/pick-folder",
				{ folder: null },
				{ method: "POST" },
			);
			if (folder && !folders.includes(folder)) {
				saveFolders([...folders, folder]);
			}
		} catch {}
	}, [folders, saveFolders]);

	if (!loadedFolders) return null;

	return (
		<div
			{...stylex.props(styles.section, contained && styles.sectionContained)}
		>
			<h4 {...stylex.props(styles.sectionHeading)}>Search folders</h4>
			<p {...stylex.props(styles.sectionDescription)}>
				Directories to scan when searching for projects. Use ~/path for
				home-relative paths.
			</p>
			<div {...stylex.props(styles.folderList)}>
				{folders.map((folder, idx) => (
					<div key={folder} {...stylex.props(styles.folderRow)}>
						<span {...stylex.props(styles.folderPath)}>{folder}</span>
						<IconButton
							type="button"
							onClick={() => removeFolder(idx)}
							variant="danger"
							size="xs"
							title="Remove"
						>
							<IconX size={iconSize.xs} />
						</IconButton>
					</div>
				))}
			</div>
			<div {...stylex.props(styles.folderInputRow)}>
				<input
					ref={inputRef}
					type="text"
					value={newFolder}
					onInput={setInputValue.bind(null, setNewFolder)}
					onKeyDown={(e) => {
						if (e.key === "Enter") addFolder();
					}}
					placeholder="~/path/to/folder"
					{...stylex.props(styles.folderInput)}
				/>
				<Button
					liquid={false}
					type="button"
					onClick={addFolder}
					disabled={!newFolder.trim()}
					variant="secondary"
					size="sm"
					className={stylex.props(styles.folderActionButton).className}
				>
					<IconPlus size={iconSize.sm} />
					Add
				</Button>
				<Button
					liquid={false}
					type="button"
					onClick={browseFolder}
					variant="secondary"
					size="sm"
					className={
						stylex.props(styles.browseButton, styles.folderActionButton)
							.className
					}
				>
					<IconFolder size={iconSize.sm} />
					Browse
				</Button>
			</div>
		</div>
	);
}
