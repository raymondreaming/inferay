import type { AgentDirectory } from "@contracts";
import { iconSize, surfaceStyles } from "@design-system/styles.stylex.ts";
import { useQueryResource } from "@shared/hooks/useQueryResource.tsx";
import { setInputValue } from "@shared/lib/dom.tsx";
import { IconFolder } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import {
	loadDirectoryQuickPicks,
	searchDirectories,
} from "@workspace/services/workspaceApi.ts";
import { createMemo, createSignal, For, onSettled } from "solid-js";
import { DirectoryResult } from "./DirectoryResult.tsx";
import { SelectedDirectoryChip } from "./SelectedDirectoryChip.tsx";
import { styles } from "./styles.ts";

export function InlineDirectoryPicker(props: {
	onSelect: (path: string | null) => void;
	onCancel?: () => void;
	multiSelect?: boolean;
	onMultiSelect?: (paths: string[]) => void;
	hideInput?: boolean;
	onSelectionChange?: (paths: string[]) => void;
	showStartButton?: boolean;
}) {
	const [query, setQuery] = createSignal("");
	const deferredQuery = createMemo(() => query().trim());
	const _source = useQueryResource(
		() => loadDirectoryQuickPicks,
		() => ({
			quickPicks: [],
			home: "",
		}),
		() => ({
			queryKey: ["agent", "directories", "quick"],
		}),
	);
	const _source2 = useQueryResource<AgentDirectory[]>(
		() => {
			const query = deferredQuery();
			return (signal) => searchDirectories(query, signal);
		},
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
			.filter((p) => !props.multiSelect || !selectedPaths().includes(p.path))
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
		props.onSelectionChange?.(next);
	};
	const handleItemClick = (path: string) => {
		setSelectedIndex(-1);
		if (props.multiSelect) {
			togglePath(path);
			setQuery("");
		} else {
			props.onSelect(path);
		}
	};
	const handleStart = () => {
		const _selectedPathsValue2 = selectedPaths();
		if (_selectedPathsValue2.length > 0 && props.onMultiSelect) {
			props.onMultiSelect(_selectedPathsValue2);
		} else if (_selectedPathsValue2.length === 1) {
			props.onSelect(_selectedPathsValue2[0]!);
		}
	};
	const handleKeyDown = (e: KeyboardEvent) => {
		const _selectedIndexValue = selectedIndex();
		if (itemCount() === 0) {
			if (e.key === "Escape") {
				e.preventDefault();
				props.onCancel?.();
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
			props.onCancel?.();
		}
	};
	const shortenPath = (path: string) =>
		_source.data.home && path.startsWith(_source.data.home)
			? `~${path.slice(_source.data.home.length)}`
			: path;
	return (
		<>
			{(() => {
				if (props.hideInput) {
					return (
						<div {...stylex.attrs(surfaceStyles.overlay, styles.compactRoot)}>
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
							{props.multiSelect && selectedPaths().length > 0 && (
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
								{(props.showStartButton === undefined
									? true
									: props.showStartButton) &&
									props.multiSelect &&
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
							{props.multiSelect && selectedPaths().length > 0 && (
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
