import * as stylex from "@octanejs/stylex";
import { useCallback, useEffect, useRef, useState } from "octane";
import { fetchJson } from "../../../../adapters/backend/http.ts";
import {
	iconSize,
	runtimeColor,
} from "../../../../design-system/styles.stylex.ts";
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

export function FileSearch({
	cwd,
	onSelect,
	placement = "shell",
}: {
	readonly cwd?: string | null;
	readonly onSelect: (file: FileSearchResult) => void;
	readonly placement?: "shell" | "panel" | "sidebar";
}) {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<FileSearchResult[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(-1);
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const panelInputRef = useRef<HTMLInputElement | null>(null);
	const selected = results[selectedIndex] ?? null;

	useEffect(() => {
		setQuery("");
		setResults([]);
		setSelectedIndex(-1);
		setOpen(false);
	}, [cwd]);

	useEffect(() => {
		if (!open || !cwd) return;
		const controller = new AbortController();
		const timer = window.setTimeout(() => {
			setLoading(true);
			fetchJson<{ results: FileSearchResult[] }>(
				`/api/files/search?${new URLSearchParams({ cwd, q: query, limit: "24" })}`,
				{ signal: controller.signal },
			)
				.then(({ results }) => results.filter((result) => !result.isDir))
				.then((response) => {
					setResults(response);
					setSelectedIndex(-1);
				})
				.catch(() => {
					if (!controller.signal.aborted) setResults([]);
				})
				.finally(() => {
					if (!controller.signal.aborted) setLoading(false);
				});
		}, 80);
		return () => {
			controller.abort();
			window.clearTimeout(timer);
		};
	}, [cwd, open, query]);

	useEffect(() => {
		if (!open) return;
		const close = (event: MouseEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", close);
		return () => document.removeEventListener("mousedown", close);
	}, [open]);

	const choose = useCallback(
		(file: FileSearchResult | null) => {
			if (!file) return;
			onSelect(file);
			setQuery("");
			setOpen(false);
		},
		[onSelect],
	);
	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setSelectedIndex((index) => Math.min(results.length - 1, index + 1));
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				setSelectedIndex((index) => Math.max(0, index - 1));
			} else if (event.key === "Enter") {
				event.preventDefault();
				choose(selected);
			} else if (event.key === "Escape") {
				event.preventDefault();
				setOpen(false);
			}
		},
		[choose, results.length, selected],
	);

	const openSearch = () => {
		setSelectedIndex(-1);
		setOpen((current) => placement !== "panel" || !current);
		window.setTimeout(() => panelInputRef.current?.focus(), 0);
	};

	const inputProps = {
		ref: panelInputRef,
		type: "text",
		autoComplete: "off",
		autoCorrect: "off",
		autoCapitalize: "off",
		spellCheck: false,
		value: query,
		onKeyDown: handleKeyDown,
		...stylex.props(styles.input),
	};

	return (
		<div
			ref={rootRef}
			{...stylex.props(
				styles.root,
				placement === "shell"
					? open
						? styles.rootShellOpen
						: styles.rootShellClosed
					: placement === "sidebar"
						? styles.rootSidebar
						: styles.rootPanel,
			)}
		>
			{placement === "panel" || (placement === "shell" && !open) ? (
				<button
					type="button"
					disabled={!cwd}
					onPointerDown={(event) => {
						if (placement === "panel" && event.button === 0 && event.isPrimary)
							openSearch();
					}}
					onClick={(event) => {
						if (placement !== "panel" || event.detail === 0) openSearch();
					}}
					title="Search workspace files"
					aria-label="Search workspace files"
					{...stylex.props(
						placement === "panel" ? styles.panelTrigger : styles.shellTrigger,
					)}
				>
					<IconSearch size={iconSize.compact} />
				</button>
			) : (
				<div {...stylex.props(styles.inputFrame)}>
					<IconSearch
						size={iconSize.compact}
						{...stylex.props(styles.searchIcon)}
					/>
					<input
						{...inputProps}
						disabled={!cwd}
						placeholder={
							cwd ? "Search workspace files" : "Open a workspace to search"
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
			{open && cwd ? (
				<div
					{...stylex.props(
						styles.menuAnchor,
						placement === "panel"
							? styles.menuPanel
							: placement === "sidebar"
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
							<div {...stylex.props(styles.menu)}>
								{placement === "panel" ? (
									<div {...stylex.props(styles.menuSearch)}>
										<IconSearch
											size={iconSize.md}
											{...stylex.props(styles.searchIcon)}
										/>
										<input
											{...inputProps}
											onInput={(event) => {
												setQuery(event.currentTarget.value);
												setSelectedIndex(-1);
											}}
											placeholder="Search workspace files"
										/>
									</div>
								) : null}
								{results.map((result, index) => (
									<FileSearchResultRow
										key={result.path}
										result={result}
										index={index}
										selectedIndex={selectedIndex}
										setSelectedIndex={setSelectedIndex}
										choose={choose}
									/>
								))}
								{!loading && results.length === 0 ? (
									<span {...stylex.props(styles.empty)}>No matching files</span>
								) : null}
							</div>
						</LiquidItem>
					</GooeyRoot>
				</div>
			) : null}
		</div>
	);
}
