import { iconSize } from "@design-system/styles.stylex.ts";
import { useQueryResource } from "@shared/hooks/useQueryResource.tsx";
import { setInputValue } from "@shared/lib/dom.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { IconButton } from "@shared/ui/IconButton/index.tsx";
import { IconFolder, IconPlus, IconX } from "@shared/ui/Icons/index.tsx";
import {
	SettingsEmpty,
	SettingsRow,
	SettingsSection,
} from "@shared/ui/SettingsSurface/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For } from "solid-js";
import { settingsApi } from "../../services/settingsApi.ts";
import { styles } from "./styles.ts";

const EMPTY_FOLDERS: string[] = [];
export function SearchFoldersSection() {
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
			const folder = await settingsApi.pickSearchFolder();
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
					<SettingsSection
						id="search-folders"
						title="Search folders"
						description="Directories to scan when searching for projects. Use ~/path for home-relative paths."
						action={
							<Button
								type="button"
								onClick={browseFolder}
								variant="ghost"
								size="sm"
								class={stylex.attrs(styles.noShrink).class}
							>
								<IconFolder size={iconSize.md} />
								<span>Browse</span>
							</Button>
						}
					>
						{folders().length === 0 ? (
							<SettingsEmpty>No search folders yet.</SettingsEmpty>
						) : (
							<For each={folders()} keyed={(row) => row}>
								{(folder, idx) => (
									<SettingsRow>
										<span {...stylex.attrs(styles.folderPath)}>{folder()}</span>
										<IconButton
											type="button"
											onClick={() => removeFolder(idx())}
											variant="danger"
											size="xs"
											title="Remove folder"
											aria-label="Remove folder"
										>
											<IconX size={iconSize.xs} />
										</IconButton>
									</SettingsRow>
								)}
							</For>
						)}
						<SettingsRow label="Add a folder">
							<input
								ref={(element) => (inputRef.current = element)}
								type="text"
								value={_newFolderValue}
								onInput={setInputValue.bind(null, setNewFolder)}
								onKeyDown={(e) => {
									if (e.key === "Enter") addFolder();
								}}
								placeholder="~/path/to/folder"
								aria-label="Folder path"
								{...stylex.attrs(styles.folderInput)}
							/>
							<Button
								type="button"
								onClick={addFolder}
								disabled={!_newFolderValue.trim()}
								variant="ghost"
								size="sm"
								class={stylex.attrs(styles.noShrink).class}
							>
								<IconPlus size={iconSize.md} />
								<span>Add</span>
							</Button>
						</SettingsRow>
					</SettingsSection>
				);
			})()}
		</>
	);
}
async function fetchSearchFolders() {
	return settingsApi.loadSearchFolders();
}
export async function saveSearchFolders(folders: string[]) {
	await settingsApi.saveSearchFolders(folders);
}
