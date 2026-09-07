import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For } from "solid-js";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { useQueryResource } from "../../../../shared/hooks/useQueryResource.tsx";
import { setInputValue } from "../../../../shared/lib/dom.tsx";
import {
	fetchJsonOr,
	pickCloneDirectory,
	sendJson,
} from "../../../../shared/lib/native.tsx";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import { IconButton } from "../../../../shared/ui/IconButton/index.tsx";
import {
	IconFolder,
	IconPlus,
	IconX,
} from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";

const EMPTY_FOLDERS: string[] = [];
export function SearchFoldersSection(_props: { contained?: boolean }) {
	const _source = useQueryResource<string[] | null>(
		() => fetchSearchFolders,
		() => null,
		() => ({
			queryKey: ["agent", "search-folders"],
		}),
	);
	const folders = createMemo(() => _source.data ?? EMPTY_FOLDERS);
	const [newFolder, setNewFolder] = createSignal("");
	const inputRef = {
		current: null,
	} as {
		current: HTMLInputElement | null;
	};
	const saveFolders = async (next: string[]) => {
		_source.setData(next);
		await saveSearchFolders(next);
	};
	const addFolder = () => {
		const _foldersValue = folders();
		const folder = newFolder().trim();
		if (!folder || _foldersValue.includes(folder)) return;
		saveFolders([..._foldersValue, folder]);
		setNewFolder("");
		inputRef.current?.focus();
	};
	const removeFolder = (idx: number) => {
		saveFolders(folders().filter((_, candidate) => candidate !== idx));
	};
	const browseFolder = async () => {
		const _foldersValue2 = folders();
		try {
			const folder = await pickCloneDirectory();
			if (folder && !_foldersValue2.includes(folder)) {
				saveFolders([..._foldersValue2, folder]);
			}
		} catch {}
	};
	return (
		<>
			{(() => {
				const _newFolderValue = newFolder();
				if (!_source.data) return null;
				return (
					<div
						{...stylex.attrs(
							styles.section,
							(_props.contained === undefined ? false : _props.contained) &&
								styles.sectionContained,
						)}
					>
						<h4 {...stylex.attrs(styles.sectionHeading)}>Search folders</h4>
						<p {...stylex.attrs(styles.sectionDescription)}>
							Directories to scan when searching for projects. Use ~/path for
							home-relative paths.
						</p>
						<div {...stylex.attrs(styles.folderList)}>
							{
								<For each={folders()} keyed={(row) => row}>
									{(folder, idx) => (
										<div {...stylex.attrs(styles.folderRow)}>
											<span {...stylex.attrs(styles.folderPath)}>
												{folder()}
											</span>
											<IconButton
												type="button"
												onClick={() => removeFolder(idx())}
												variant="danger"
												size="xs"
												title="Remove"
											>
												<IconX size={iconSize.xs} />
											</IconButton>
										</div>
									)}
								</For>
							}
						</div>
						<div {...stylex.attrs(styles.folderInputRow)}>
							<input
								ref={(element) => (inputRef.current = element)}
								type="text"
								value={_newFolderValue}
								onInput={setInputValue.bind(null, setNewFolder)}
								onKeyDown={(e) => {
									if (e.key === "Enter") addFolder();
								}}
								placeholder="~/path/to/folder"
								{...stylex.attrs(styles.folderInput)}
							/>
							<Button
								liquid={false}
								type="button"
								onClick={addFolder}
								disabled={!_newFolderValue.trim()}
								variant="secondary"
								size="sm"
								class={stylex.attrs(styles.folderActionButton).class}
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
								class={
									stylex.attrs(styles.browseButton, styles.folderActionButton)
										.class
								}
							>
								<IconFolder size={iconSize.sm} />
								Browse
							</Button>
						</div>
					</div>
				);
			})()}
		</>
	);
}
export async function fetchSearchFolders() {
	return (
		await fetchJsonOr<{
			folders: string[];
		}>("/api/config/search-folders", {
			folders: [],
		})
	).folders;
}
export async function saveSearchFolders(folders: string[]) {
	await sendJson(
		"/api/config/search-folders",
		{
			folders,
		},
		{
			method: "PUT",
		},
	);
}
