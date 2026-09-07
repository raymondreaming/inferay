import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal, For } from "solid-js";
import {
	iconSize,
	runtimeColor,
} from "../../../../design-system/styles.stylex.ts";
import { useBackgroundQuery } from "../../../../shared/hooks/useQueryResource.tsx";
import { assignRef, queryClient } from "../../../../shared/lib/dom.tsx";
import { fetchJson } from "../../../../shared/lib/native.tsx";
import { GooeyRoot } from "../../../../shared/ui/gooey/Gooey/index.tsx";
import { LiquidItem } from "../../../../shared/ui/gooey/LiquidItem/index.tsx";
import { IconSearch } from "../../../../shared/ui/Icons/index.tsx";
import { FileSearchResultRow } from "./FileSearchResultRow.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
export type FileSearchResult = {
	readonly cwd?: string;
	readonly isDir: boolean;
	readonly name: string;
	readonly path: string;
};
export function FileSearch(_props: {
	readonly cwd?: string | null;
	readonly onSelect: (file: FileSearchResult) => void;
	readonly placement?: "shell" | "panel" | "sidebar";
}) {
	const [open, setOpen] = createSignal(() => {
		_props.cwd;
		return false;
	});
	const [query, setQuery] = createSignal(() => {
		_props.cwd;
		return "";
	});
	const [debouncedQuery, setDebouncedQuery] = createSignal("");
	createEffect(query, (text) => {
		const timer = setTimeout(() => setDebouncedQuery(text), 80);
		return () => clearTimeout(timer);
	});
	const resultQuery = useBackgroundQuery(
		() => {
			const cwd = _props.cwd;
			const text = debouncedQuery();
			return {
				queryKey: ["file-search", cwd, text],
				enabled: open() && !!cwd,
				queryFn: async ({ signal }: { signal: AbortSignal }) => {
					const response = await fetchJson<{
						results: FileSearchResult[];
					}>(
						`/api/files/search?${new URLSearchParams({
							cwd: cwd!,
							q: text,
							limit: "24",
						})}`,
						{
							signal,
						},
					);
					return response.results.filter((result) => !result.isDir);
				},
				retry: false,
			};
		},
		() => queryClient,
	);
	const results = () => resultQuery.data ?? [];
	const [selectedIndex, setSelectedIndex] = createSignal(() => {
		results();
		return -1;
	});
	const loading = () => resultQuery.isFetching;
	const rootRef = {
		current: null,
	} as {
		current: HTMLDivElement | null;
	};
	const panelInputRef = {
		current: null,
	} as {
		current: HTMLInputElement | null;
	};
	const selected = createMemo(() => results()[selectedIndex()] ?? null);
	createEffect(
		() => [open()],
		() => {
			if (!open()) return;
			const close = (event: MouseEvent) => {
				if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
			};
			document.addEventListener("mousedown", close);
			return () => document.removeEventListener("mousedown", close);
		},
	);
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
			choose(selected());
		} else if (event.key === "Escape") {
			event.preventDefault();
			setOpen(false);
		}
	};
	const openSearch = () => {
		setSelectedIndex(-1);
		setOpen(
			(current) =>
				(_props.placement === undefined ? "shell" : _props.placement) !==
					"panel" || !current,
		);
		window.setTimeout(() => panelInputRef.current?.focus(), 0);
	};
	const inputProps = createMemo(() => ({
		ref: (element: HTMLInputElement) => assignRef(panelInputRef, element),
		type: "text",
		autoComplete: "off",
		autoCorrect: "off",
		autoCapitalize: "off",
		spellCheck: false,
		value: query(),
		onKeyDown: handleKeyDown,
		...stylex.attrs(styles.input),
	}));
	return (
		<div
			ref={(element) => (rootRef.current = element)}
			{...stylex.attrs(
				styles.root,
				(_props.placement === undefined ? "shell" : _props.placement) ===
					"shell"
					? open()
						? styles.rootShellOpen
						: styles.rootShellClosed
					: (_props.placement === undefined ? "shell" : _props.placement) ===
							"sidebar"
						? styles.rootSidebar
						: styles.rootPanel,
			)}
		>
			{(_props.placement === undefined ? "shell" : _props.placement) ===
				"panel" ||
			((_props.placement === undefined ? "shell" : _props.placement) ===
				"shell" &&
				!open()) ? (
				<button
					type="button"
					disabled={!_props.cwd}
					onPointerDown={(event) => {
						if (
							(_props.placement === undefined ? "shell" : _props.placement) ===
								"panel" &&
							event.button === 0 &&
							event.isPrimary
						)
							openSearch();
					}}
					onClick={(event) => {
						if (
							(_props.placement === undefined ? "shell" : _props.placement) !==
								"panel" ||
							event.detail === 0
						)
							openSearch();
					}}
					title="Search workspace files"
					aria-label="Search workspace files"
					{...stylex.attrs(
						(_props.placement === undefined ? "shell" : _props.placement) ===
							"panel"
							? styles.panelTrigger
							: styles.shellTrigger,
					)}
				>
					<IconSearch size={iconSize.compact} />
				</button>
			) : (
				<div {...stylex.attrs(styles.inputFrame)}>
					<IconSearch
						size={iconSize.compact}
						{...stylex.attrs(styles.searchIcon)}
					/>
					<input
						{...inputProps()}
						disabled={!_props.cwd}
						placeholder={
							_props.cwd
								? "Search workspace files"
								: "Open a workspace to search"
						}
						onFocus={() => {
							setSelectedIndex(-1);
							setOpen(true);
						}}
						onInput={(event) => {
							setQuery(event.currentTarget.value);
							setSelectedIndex(-1);
							setOpen(true);
						}}
					/>
				</div>
			)}
			{open() && _props.cwd ? (
				<div
					{...stylex.attrs(
						styles.menuAnchor,
						(_props.placement === undefined ? "shell" : _props.placement) ===
							"panel"
							? styles.menuPanel
							: (_props.placement === undefined
										? "shell"
										: _props.placement) === "sidebar"
								? styles.menuSidebar
								: styles.menuShell,
					)}
				>
					<GooeyRoot
						blur={6}
						contrast={18}
						fill={runtimeColor.backgroundRaised}
						filterPadding={32}
						shadow="inset 0 1px 0 rgba(255,255,255,.12), 0 10px 28px rgba(0,0,0,.34)"
						style={inlineStyles.getFileSearchLiquidStyle()}
					>
						<LiquidItem style={inlineStyles.getFileSearchElementStyle()}>
							<div {...stylex.attrs(styles.menu)}>
								{(_props.placement === undefined
									? "shell"
									: _props.placement) === "panel" ? (
									<div {...stylex.attrs(styles.menuSearch)}>
										<IconSearch
											size={iconSize.md}
											{...stylex.attrs(styles.searchIcon)}
										/>
										<input
											{...inputProps()}
											onInput={(event) => {
												setQuery(event.currentTarget.value);
												setSelectedIndex(-1);
											}}
											placeholder="Search workspace files"
										/>
									</div>
								) : null}
								{
									<For each={results()} keyed={(row) => row.path}>
										{(result, index) => (
											<FileSearchResultRow
												result={result()}
												index={index()}
												selectedIndex={selectedIndex()}
												setSelectedIndex={setSelectedIndex}
												choose={choose}
											/>
										)}
									</For>
								}
								{!loading() && results().length === 0 ? (
									<span {...stylex.attrs(styles.empty)}>No matching files</span>
								) : null}
							</div>
						</LiquidItem>
					</GooeyRoot>
				</div>
			) : null}
		</div>
	);
}
