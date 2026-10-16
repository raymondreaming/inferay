import type { AgentDirectory } from "@contracts";
import { iconSize, surfaceStyles } from "@design-system/styles.stylex.ts";
import { useQueryResource } from "@shared/hooks/useQueryResource.tsx";
import { basename, setInputValue } from "@shared/lib/dom.tsx";
import {
	IconChevronRight,
	IconFolder,
	IconGitBranch,
	IconX,
} from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import {
	loadDirectoryQuickPicks,
	searchDirectories,
} from "@workspace/services/workspaceApi.ts";
import { createMemo, createSignal, For, onSettled } from "solid-js";
import { styles } from "./styles.ts";

const MAX_VISIBLE_RESULTS = 30;
export function InlineDirectoryPicker(
	props: {
		onCancel?: () => void;
		stableHeight?: boolean;
		excludePaths?: readonly string[];
	} & (
		| { onSelect: (path: string) => void; onSelectionChange?: never }
		| { onSelect?: never; onSelectionChange: (paths: string[]) => void }
	),
) {
	const [query, setQuery] = createSignal("");
	const deferredQuery = createMemo(() => query().trim());
	const quick = useQueryResource(() => ({
		queryKey: ["agent", "directories", "quick"],
		queryFn: loadDirectoryQuickPicks,
		initialData: { quickPicks: [], home: "" },
	}));
	const search = useQueryResource<AgentDirectory[]>(() => {
		const query = deferredQuery();
		return {
			queryKey: ["agent", "directories", "search", query],
			queryFn: ({ signal }) => searchDirectories(query, signal),
			initialData: [],
		};
	});
	const [selectedIndexValue, setSelectedIndex] = createSignal(-1);
	const [selectedPaths, setSelectedPaths] = createSignal<string[]>([]);
	let input: HTMLInputElement | undefined;
	const isSearching = createMemo(() => deferredQuery().length > 0);
	const displayList = createMemo(() =>
		(isSearching() ? search.data : quick.data.quickPicks)
			.filter(
				(p) =>
					!props.excludePaths?.includes(p.path) &&
					(!props.onSelectionChange || !selectedPaths().includes(p.path)),
			)
			.slice(0, MAX_VISIBLE_RESULTS),
	);
	const itemCount = createMemo(() => displayList().length);
	const selectedIndex = createMemo(() =>
		itemCount() === 0
			? -1
			: Math.min(Math.max(selectedIndexValue(), 0), itemCount() - 1),
	);
	const loading = createMemo(() => isSearching() && search.loading);
	onSettled(() => {
		const timer = setTimeout(() => input?.focus(), 10);
		return () => clearTimeout(timer);
	});
	const togglePath = (path: string) => {
		const current = selectedPaths();
		const next = current.includes(path)
			? current.filter((selected) => selected !== path)
			: [...current, path];
		setSelectedPaths(next);
		props.onSelectionChange?.(next);
	};
	const selectPath = (path: string) => {
		setSelectedIndex(-1);
		if (props.onSelectionChange) {
			togglePath(path);
			setQuery("");
		} else props.onSelect(path);
	};
	const handleKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Escape") {
			event.preventDefault();
			props.onCancel?.();
		} else if (itemCount() > 0) {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setSelectedIndex((current) => (current + 1) % itemCount());
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				setSelectedIndex((current) =>
					current < 0
						? itemCount() - 1
						: (current - 1 + itemCount()) % itemCount(),
				);
			} else if (event.key === "Enter") {
				event.preventDefault();
				const path = displayList()[selectedIndex()]?.path;
				if (path) selectPath(path);
			}
		}
	};
	const shortenPath = (path: string) =>
		quick.data.home && path.startsWith(quick.data.home)
			? `~${path.slice(quick.data.home.length)}`
			: path;
	return (
		<div {...stylex.attrs(styles.root)}>
			<div
				data-onboarding="repository-picker"
				{...stylex.attrs(
					styles.unifiedFrame,
					props.stableHeight && styles.stableFrame,
				)}
			>
				<div {...stylex.attrs(styles.inputRow)}>
					<span {...stylex.attrs(styles.inputIcon)}>
						<IconFolder size={iconSize.lg} />
					</span>
					<input
						ref={(element) => (input = element)}
						type="text"
						value={query()}
						onInput={(event) => {
							setInputValue(setQuery, event);
							setSelectedIndex(-1);
						}}
						onKeyDown={handleKeyDown}
						aria-label="Repository folder search"
						placeholder="Search folder..."
						autocomplete="off"
						autocorrect="off"
						autocapitalize="off"
						spellcheck={false}
						{...stylex.attrs(styles.input)}
					/>
					{loading() && <div {...stylex.attrs(styles.spinner)} />}
				</div>
				{(props.stableHeight || itemCount() > 0) && (
					<div
						{...stylex.attrs(
							styles.unifiedList,
							props.stableHeight && styles.stableList,
						)}
					>
						{itemCount() === 0 && (
							<p role="status" {...stylex.attrs(styles.emptyResults)}>
								{loading()
									? "Searching…"
									: "No folders found. Try another name."}
							</p>
						)}
						<For each={displayList()} keyed={(row) => row.path}>
							{(pick, index) => (
								<button
									type="button"
									onMouseDown={(event) => event.preventDefault()}
									onMouseMove={() => setSelectedIndex(index())}
									onClick={() => selectPath(pick().path)}
									{...stylex.attrs(
										styles.resultRowCompact,
										index() === selectedIndex() &&
											selectedIndexValue() >= 0 &&
											styles.resultRowActiveAccent,
									)}
								>
									<span
										{...stylex.attrs(
											styles.resultIcon,
											index() === selectedIndex() && styles.accentText,
										)}
									>
										{pick().isGitRepo ? (
											<IconGitBranch size={iconSize.md} />
										) : (
											<IconFolder size={iconSize._2md} />
										)}
									</span>
									<div {...stylex.attrs(styles.resultText)}>
										<span {...stylex.attrs(styles.resultName)}>
											{pick().name}
										</span>
										<span {...stylex.attrs(styles.resultPathSmall)}>
											{shortenPath(pick().path)}
										</span>
									</div>
									<IconChevronRight
										size={iconSize.sm}
										{...stylex.attrs(styles.chevron)}
									/>
								</button>
							)}
						</For>
					</div>
				)}
				{props.onSelectionChange && selectedPaths().length > 0 && (
					<div
						{...stylex.attrs(
							styles.selectedWrap,
							props.stableHeight && styles.stableSelection,
						)}
					>
						<div {...stylex.attrs(styles.selectedList)}>
							<For each={selectedPaths()} keyed={(row) => row}>
								{(path) => (
									<span
										{...stylex.attrs(
											surfaceStyles.overlay,
											styles.selectedTagStrong,
										)}
									>
										{basename(path())}
										<button
											type="button"
											onClick={() => togglePath(path())}
											{...stylex.attrs(styles.tagRemove)}
										>
											<IconX size={iconSize.sm} />
										</button>
									</span>
								)}
							</For>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
