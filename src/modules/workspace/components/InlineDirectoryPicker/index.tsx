import * as stylex from "@stylexjs/stylex";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onSettled,
} from "solid-js";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { useQueryResource } from "../../../../shared/hooks/useQueryResource.tsx";
import { setInputValue } from "../../../../shared/lib/dom.tsx";
import { fetchJsonOr } from "../../../../shared/lib/native.tsx";
import { IconFolder } from "../../../../shared/ui/Icons/index.tsx";
import { DirectoryResult } from "./DirectoryResult.tsx";
import { SelectedDirectoryChip } from "./SelectedDirectoryChip.tsx";
import { styles } from "./styles.ts";

type QuickPick = {
	name: string;
	path: string;
	isGitRepo: boolean;
};
interface InlineDirectoryPickerProps {
	onSelect: (path: string | null) => void;
	onCancel?: () => void;
	multiSelect?: boolean;
	onMultiSelect?: (paths: string[]) => void;
	hideInput?: boolean;
	onSelectionChange?: (paths: string[]) => void;
	showStartButton?: boolean;
}
export function InlineDirectoryPicker(_props: InlineDirectoryPickerProps) {
	const [query, setQuery] = createSignal("");
	const deferredQuery = createMemo(() => query().trim());
	const fetchPickerData = async () => {
		const data = await fetchJsonOr<{
			quickPicks?: QuickPick[];
			home?: string;
		}>("/api/agent/directories?quickPicks=true", {});
		return {
			quickPicks: data.quickPicks ?? [],
			homePath: data.home ?? "",
		};
	};
	const _source = useQueryResource(
		() => fetchPickerData,
		() => ({
			quickPicks: [],
			homePath: "",
		}),
		() => ({
			queryKey: ["agent", "directories", "quick"],
		}),
	);
	const fetchSearchResults = async () => {
		const _deferredQueryValue = deferredQuery();
		if (!_deferredQueryValue) return [];
		const data = await fetchJsonOr<{
			directories?: Array<{
				name: string;
				path: string;
			}>;
		}>(
			`/api/agent/directories?q=${encodeURIComponent(_deferredQueryValue)}`,
			{},
		);
		return (data.directories ?? []).map((directory) => ({
			...directory,
			isGitRepo: false,
		}));
	};
	const _source2 = useQueryResource<QuickPick[]>(
		() => fetchSearchResults,
		() => [],
		() => ({
			queryKey: ["agent", "directories", "search", deferredQuery()],
		}),
	);
	const [selectedIndexValue, setSelectedIndex] = createSignal(-1);
	const [selectedPaths, setSelectedPaths] = createSignal<string[]>([]);
	const inputRef = {
		current: null,
	} as {
		current: HTMLInputElement | null;
	};
	const containerRef = {
		current: null,
	} as {
		current: HTMLDivElement | null;
	};
	const isSearching = createMemo(() => deferredQuery().length > 0);
	const displayList = createMemo(() =>
		(isSearching() ? _source2.data : _source.data.quickPicks)
			.filter((p) => !_props.multiSelect || !selectedPaths().includes(p.path))
			.slice(0, 5),
	);
	const itemCount = createMemo(() => displayList().length);
	const selectedIndex = createMemo(() => {
		const _itemCountValue = itemCount(),
			_selectedIndexValueValue = selectedIndexValue();
		return _itemCountValue === 0
			? -1
			: _selectedIndexValueValue < 0
				? 0
				: Math.min(_selectedIndexValueValue, _itemCountValue - 1);
	});
	const loading = createMemo(() => isSearching() && _source2.loading);
	onSettled(() => {
		const timer = setTimeout(() => inputRef.current?.focus(), 10);
		return () => {
			clearTimeout(timer);
		};
	});
	const togglePath = (path: string) => {
		const _selectedPathsValue = selectedPaths();
		const next = _selectedPathsValue.includes(path)
			? _selectedPathsValue.filter((selected) => selected !== path)
			: [..._selectedPathsValue, path];
		setSelectedPaths(next);
		_props.onSelectionChange?.(next);
	};
	const handleItemClick = (path: string) => {
		setSelectedIndex(-1);
		if (_props.multiSelect) {
			togglePath(path);
			setQuery("");
		} else {
			_props.onSelect(path);
		}
	};
	const handleStart = () => {
		const _selectedPathsValue2 = selectedPaths();
		if (_selectedPathsValue2.length > 0 && _props.onMultiSelect) {
			_props.onMultiSelect(_selectedPathsValue2);
		} else if (_selectedPathsValue2.length === 1) {
			_props.onSelect(_selectedPathsValue2[0]!);
		}
	};
	const handleKeyDown = (e: KeyboardEvent) => {
		const _selectedIndexValue = selectedIndex();
		if (itemCount() === 0) {
			if (e.key === "Escape") {
				e.preventDefault();
				_props.onCancel?.();
			}
			return;
		}
		if (e.key === "ArrowDown" || e.key === "Tab") {
			e.preventDefault();
			setSelectedIndex((current) => (current + 1) % itemCount());
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setSelectedIndex((current) => {
				const _itemCountValue2 = itemCount();
				return current < 0
					? _itemCountValue2 - 1
					: (current - 1 + _itemCountValue2) % _itemCountValue2;
			});
		} else if (e.key === "Enter") {
			e.preventDefault();
			const idx = _selectedIndexValue >= 0 ? _selectedIndexValue : 0;
			const path = displayList()[idx]?.path;
			if (path) handleItemClick(path);
		} else if (e.key === "Escape") {
			e.preventDefault();
			_props.onCancel?.();
		}
	};
	const shortenPath = (path: string) =>
		_source.data.homePath && path.startsWith(_source.data.homePath)
			? `~${path.slice(_source.data.homePath.length)}`
			: path;
	return (
		<>
			{(() => {
				if (_props.hideInput) {
					return (
						<div {...stylex.attrs(styles.compactRoot)}>
							<div {...stylex.attrs(styles.compactList)}>
								{
									<For each={displayList()} keyed={(row) => row.path}>
										{(pick, i) => (
											<DirectoryResult
												pick={pick()}
												active={i() === selectedIndex()}
												displayPath={shortenPath(pick().path)}
												onSelect={handleItemClick}
											/>
										)}
									</For>
								}
							</div>
							{_props.multiSelect && selectedPaths().length > 0 && (
								<div {...stylex.attrs(styles.selectedBar)}>
									{
										<For
											each={selectedPaths().slice(0, 4)}
											keyed={(row) => row}
										>
											{(p) => (
												<SelectedDirectoryChip
													path={p()}
													onRemove={togglePath}
												/>
											)}
										</For>
									}
									{selectedPaths().length > 4 && (
										<span {...stylex.attrs(styles.moreCount)}>
											+{selectedPaths().length - 4}
										</span>
									)}
								</div>
							)}
						</div>
					);
				}
				return (
					<div
						{...stylex.attrs(styles.root)}
						ref={(element) => (containerRef.current = element)}
					>
						<div {...stylex.attrs(styles.unifiedFrame)}>
							<div {...stylex.attrs(styles.inputRow)}>
								<span {...stylex.attrs(styles.inputIcon)}>
									<IconFolder size={iconSize.lg} />
								</span>
								<input
									ref={(element) => (inputRef.current = element)}
									type="text"
									value={query()}
									onInput={(event) => {
										setInputValue(setQuery, event);
										setSelectedIndex(-1);
									}}
									onKeyDown={handleKeyDown}
									placeholder="Search folder..."
									autocomplete="off"
									autocorrect="off"
									autocapitalize="off"
									spellcheck={false}
									{...stylex.attrs(styles.input)}
								/>
								{loading() && <div {...stylex.attrs(styles.spinner)} />}
								{(_props.showStartButton === undefined
									? true
									: _props.showStartButton) &&
									_props.multiSelect &&
									selectedPaths().length > 0 && (
										<button
											type="button"
											onClick={handleStart}
											{...stylex.attrs(styles.startButton)}
										>
											Start
											{selectedPaths().length > 1
												? ` (${selectedPaths().length})`
												: ""}
										</button>
									)}
							</div>
							{itemCount() > 0 && (
								<div {...stylex.attrs(styles.unifiedList)}>
									{
										<For each={displayList()} keyed={(row) => row.path}>
											{(pick, i) => (
												<DirectoryResult
													pick={pick()}
													active={i() === selectedIndex()}
													displayPath={shortenPath(pick().path)}
													onSelect={handleItemClick}
													searchable
													highlight={selectedIndexValue() >= 0}
													onHover={() => setSelectedIndex(i())}
												/>
											)}
										</For>
									}
								</div>
							)}
							{_props.multiSelect && selectedPaths().length > 0 && (
								<div {...stylex.attrs(styles.selectedWrap)}>
									<div {...stylex.attrs(styles.selectedList)}>
										{
											<For each={selectedPaths()} keyed={(row) => row}>
												{(p, i) => (
													<SelectedDirectoryChip
														path={p()}
														onRemove={togglePath}
														primary={i() === 0}
														strong
													/>
												)}
											</For>
										}
									</div>
								</div>
							)}
						</div>
					</div>
				);
			})()}
		</>
	);
}
