import type { ProjectFileEntry } from "@contracts";
import { iconSize, surfaceStyles } from "@design-system/styles.stylex.ts";
import { searchFiles } from "@explorer/services/explorerApi.ts";
import { useBackgroundQuery } from "@shared/hooks/useQueryResource.tsx";
import { IconSearch } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createEffect, createSignal, For } from "solid-js";
import { FileTypeIcon } from "../FileTypeIcon/index.tsx";
import { styles } from "./styles.ts";
export type FileSearchResult = ProjectFileEntry;
export function FileSearch(_props: {
	readonly cwd?: string | null;
	readonly onSelect: (file: FileSearchResult) => void;
}) {
	const [open, setOpen] = createSignal(() => {
		void _props.cwd;
		return false;
	});
	const [query, setQuery] = createSignal(() => {
		void _props.cwd;
		return "";
	});
	const [debouncedQuery, setDebouncedQuery] = createSignal("");
	createEffect(query, (text) => {
		const timer = setTimeout(() => setDebouncedQuery(text), 80);
		return () => clearTimeout(timer);
	});
	const resultQuery = useBackgroundQuery(() => {
		const cwd = _props.cwd;
		const text = debouncedQuery();
		return {
			queryKey: ["file-search", cwd, text],
			enabled: open() && !!cwd,
			queryFn: ({ signal }: { signal: AbortSignal }) =>
				searchFiles(cwd!, text, signal),
			retry: false,
		};
	});
	const results = () => resultQuery.data ?? [];
	const [selectedIndex, setSelectedIndex] = createSignal(() => {
		results();
		return -1;
	});
	const loading = () => resultQuery.isFetching;
	let root: HTMLDivElement | undefined;
	let input: HTMLInputElement | undefined;
	createEffect(open, (isOpen) => {
		if (!isOpen) return;
		const close = (event: MouseEvent) => {
			if (!root?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", close);
		return () => document.removeEventListener("mousedown", close);
	});
	const choose = (file: FileSearchResult | null) => {
		if (!file) return;
		_props.onSelect(file);
		setQuery("");
		setOpen(false);
	};
	const handleKeyDown = (event: KeyboardEvent) => {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setSelectedIndex((index) => Math.min(results().length - 1, index + 1));
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			setSelectedIndex((index) => Math.max(0, index - 1));
		} else if (event.key === "Enter") {
			event.preventDefault();
			choose(results()[selectedIndex()] ?? null);
		} else if (event.key === "Escape") {
			event.preventDefault();
			setOpen(false);
		}
	};
	const openSearch = () => {
		setSelectedIndex(-1);
		setOpen((current) => !current);
		window.setTimeout(() => input?.focus(), 0);
	};
	return (
		<div
			ref={(element) => (root = element)}
			{...stylex.attrs(styles.root, styles.rootPanel)}
		>
			<button
				type="button"
				disabled={!_props.cwd}
				onPointerDown={(event) => {
					if (event.button === 0 && event.isPrimary) openSearch();
				}}
				onClick={(event) => {
					if (event.detail === 0) openSearch();
				}}
				title="Search workspace files"
				aria-label="Search workspace files"
				{...stylex.attrs(styles.panelTrigger)}
			>
				<IconSearch size={iconSize.compact} />
			</button>
			{open() && _props.cwd ? (
				<div {...stylex.attrs(styles.menuAnchor, styles.menuPanel)}>
					<div {...stylex.attrs(surfaceStyles.overlay, styles.menu)}>
						<div {...stylex.attrs(styles.menuSearch)}>
							<IconSearch
								size={iconSize.md}
								{...stylex.attrs(styles.searchIcon)}
							/>
							<input
								ref={(element) => (input = element)}
								type="text"
								autocomplete="off"
								autocorrect="off"
								autocapitalize="off"
								spellcheck={false}
								value={query()}
								onKeyDown={handleKeyDown}
								onInput={(event) => {
									setQuery(event.currentTarget.value);
									setSelectedIndex(-1);
								}}
								placeholder="Search workspace files"
								{...stylex.attrs(styles.input)}
							/>
						</div>
						<For each={results()} keyed={(row) => row.path}>
							{(result, index) => {
								const name = () =>
									result().path.split("/").pop() || result().path;
								return (
									<button
										type="button"
										onMouseEnter={() => setSelectedIndex(index())}
										onPointerDown={(event) => {
											if (event.button === 0 && event.isPrimary)
												choose(result());
										}}
										onClick={(event) => {
											if (event.detail === 0) choose(result());
										}}
										{...stylex.attrs(
											styles.result,
											index() === selectedIndex() && styles.resultActive,
										)}
									>
										<FileTypeIcon path={result().path} size={iconSize.lg} />
										<span {...stylex.attrs(styles.resultText)}>
											<strong {...stylex.attrs(styles.resultName)}>
												{name()}
											</strong>
											<small {...stylex.attrs(styles.resultPath)}>
												{result().path === name()
													? "Project root"
													: result().path.slice(0, -(name().length + 1))}
											</small>
										</span>
									</button>
								);
							}}
						</For>
						{!loading() && results().length === 0 ? (
							<span {...stylex.attrs(styles.empty)}>No matching files</span>
						) : null}
					</div>
				</div>
			) : null}
		</div>
	);
}
