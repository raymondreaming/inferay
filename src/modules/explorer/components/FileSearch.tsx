import * as stylex from "@octanejs/stylex";
import { useCallback, useEffect, useRef, useState } from "octane";
import { fetchJson } from "../../../adapters/backend/http.ts";
import { iconSize, runtimeColor } from "../../../design-system.ts";
import { Liquid } from "../../../shared/ui/gooey/index.ts";
import { IconSearch } from "../../../shared/ui/Icons.tsx";
import {
	color,
	controlSize,
	effect,
	font,
	layer,
	radius,
} from "../../../tokens.stylex.ts";
import { FileTypeIcon } from "./FileTypeIcon.tsx";

export type FileSearchResult = {
	readonly cwd?: string;
	readonly isDir: boolean;
	readonly name: string;
	readonly path: string;
};

type FileSearchResponse = {
	readonly results: FileSearchResult[];
};

function fileName(path: string) {
	return path.split("/").pop() || path;
}

function fileDirectory(path: string) {
	const name = fileName(path);
	return path === name ? "Project root" : path.slice(0, -(name.length + 1));
}

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
			const params = new URLSearchParams({ cwd, q: query, limit: "24" });
			fetchJson<FileSearchResponse>(`/api/files/search?${params}`, {
				signal: controller.signal,
			})
				.then((response) => {
					setResults(response.results.filter((result) => !result.isDir));
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
			{placement === "panel" ? (
				<button
					type="button"
					disabled={!cwd}
					onPointerDown={(event) => {
						if (event.button !== 0 || !event.isPrimary) return;
						setSelectedIndex(-1);
						setOpen((current) => !current);
						window.setTimeout(() => panelInputRef.current?.focus(), 0);
					}}
					onClick={(event) => {
						if (event.detail !== 0) return;
						setSelectedIndex(-1);
						setOpen((current) => !current);
						window.setTimeout(() => panelInputRef.current?.focus(), 0);
					}}
					title="Search workspace files"
					aria-label="Search workspace files"
					{...stylex.props(styles.panelTrigger)}
				>
					<IconSearch size={iconSize.compact} />
				</button>
			) : placement === "shell" && !open ? (
				<button
					type="button"
					disabled={!cwd}
					onClick={() => {
						setSelectedIndex(-1);
						setOpen(true);
						window.setTimeout(() => panelInputRef.current?.focus(), 0);
					}}
					title="Search workspace files"
					aria-label="Search workspace files"
					{...stylex.props(styles.shellTrigger)}
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
						ref={panelInputRef}
						type="text"
						autoComplete="off"
						autoCorrect="off"
						autoCapitalize="off"
						spellCheck={false}
						value={query}
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
						onKeyDown={handleKeyDown}
						{...stylex.props(styles.input)}
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
					<Liquid
						blur={6}
						contrast={18}
						fill={runtimeColor.backgroundRaised}
						filterPadding={32}
						shadow="inset 0 1px 0 rgba(255,255,255,.12), 0 10px 28px rgba(0,0,0,.34)"
						style={{ display: "flex", width: "100%" }}
					>
						<Liquid.Item style={{ width: "100%" }}>
							<div {...stylex.props(styles.menu)}>
								{placement === "panel" ? (
									<div {...stylex.props(styles.menuSearch)}>
										<IconSearch
											size={iconSize.md}
											{...stylex.props(styles.searchIcon)}
										/>
										<input
											ref={panelInputRef}
											type="text"
											autoComplete="off"
											autoCorrect="off"
											autoCapitalize="off"
											spellCheck={false}
											value={query}
											onInput={(event) => {
												setQuery(event.currentTarget.value);
												setSelectedIndex(-1);
											}}
											onKeyDown={handleKeyDown}
											placeholder="Search workspace files"
											{...stylex.props(styles.input)}
										/>
									</div>
								) : null}
								{results.map((result, index) => (
									<button
										key={result.path}
										type="button"
										onMouseEnter={() => setSelectedIndex(index)}
										onPointerDown={(event) => {
											if (event.button === 0 && event.isPrimary) choose(result);
										}}
										onClick={(event) => {
											if (event.detail === 0) choose(result);
										}}
										{...stylex.props(
											styles.result,
											index === selectedIndex && styles.resultActive,
										)}
									>
										<FileTypeIcon path={result.path} size={iconSize.lg} />
										<span {...stylex.props(styles.resultText)}>
											<strong {...stylex.props(styles.resultName)}>
												{fileName(result.path)}
											</strong>
											<small {...stylex.props(styles.resultPath)}>
												{fileDirectory(result.path)}
											</small>
										</span>
									</button>
								))}
								{!loading && results.length === 0 ? (
									<span {...stylex.props(styles.empty)}>No matching files</span>
								) : null}
							</div>
						</Liquid.Item>
					</Liquid>
				</div>
			) : null}
		</div>
	);
}

const styles = stylex.create({
	root: { position: "relative", minWidth: controlSize._0 },
	rootShellClosed: {
		width: controlSize._6,
	},
	rootShellOpen: {
		width: "clamp(160px, 18vw, 240px)",
		zIndex: layer.searchPopover,
	},
	rootPanel: {
		position: "static",
		width: controlSize._6,
		flexShrink: 0,
	},
	rootSidebar: {
		width: "100%",
	},
	inputFrame: {
		display: "flex",
		height: controlSize._6,
		alignItems: "center",
		gap: controlSize._1_5,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.md,
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.controlDepth,
		paddingInline: controlSize._2,
	},
	searchIcon: { flexShrink: 0, color: color.textMuted },
	panelTrigger: {
		display: "flex",
		width: controlSize._6,
		height: controlSize._6,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: radius.md,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
	},
	shellTrigger: {
		display: "flex",
		width: controlSize._6,
		height: controlSize._6,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: radius.md,
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceWhite06,
		},
	},
	input: {
		minWidth: controlSize._0,
		flex: 1,
		borderWidth: 0,
		outline: "none",
		backgroundColor: color.transparent,
		color: color.textMain,
		fontSize: font.size_2,
		"::placeholder": { color: color.textMuted },
	},
	menuAnchor: {
		position: "absolute",
		top: "calc(100% + 5px)",
		zIndex: layer.searchPopover,
	},
	menu: {
		display: "flex",
		width: "100%",
		maxHeight: 320,
		flexDirection: "column",
		gap: controlSize._0_5,
		overflowY: "auto",
		borderWidth: 0,
		borderRadius: radius.lg,
		backgroundColor: color.transparent,
		boxShadow: "none",
		padding: controlSize._1,
	},
	menuShell: { left: controlSize._0, width: "max(100%, 330px)" },
	menuPanel: {
		left: controlSize._2,
		right: controlSize._2,
		width: "auto",
	},
	menuSidebar: {
		left: controlSize._0,
		right: controlSize._0,
		width: "auto",
	},
	menuSearch: {
		display: "flex",
		height: controlSize._8,
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._2,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		paddingInline: controlSize._2,
		marginBottom: controlSize._1,
	},
	result: {
		display: "flex",
		width: "100%",
		minWidth: controlSize._0,
		alignItems: "center",
		gap: controlSize._2,
		borderRadius: radius.md,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		color: color.textSoft,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
		textAlign: "left",
	},
	resultActive: {
		backgroundColor: color.controlActive,
		backgroundImage: effect.controlDepthHover,
		color: color.textMain,
	},
	resultText: {
		display: "flex",
		minWidth: controlSize._0,
		flex: 1,
		flexDirection: "column",
	},
	resultName: {
		overflow: "hidden",
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	resultPath: {
		overflow: "hidden",
		color: color.textMuted,
		fontSize: font.size_1,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	empty: {
		paddingBlock: controlSize._5,
		color: color.textMuted,
		fontSize: font.size_2,
		textAlign: "center",
	},
});
