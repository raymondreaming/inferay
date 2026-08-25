import * as stylex from "@octanejs/stylex";
import { useCallback, useEffect, useRef, useState } from "octane";
import { fetchJson } from "../../lib/fetch-json.ts";
import {
	color,
	controlSize,
	effect,
	font,
	radius,
} from "../../tokens.stylex.ts";
import { IconSearch } from "../ui/Icons.tsx";
import { FileTypeIcon } from "./FileTypeIcon.tsx";

export type WorkspaceFileSearchResult = {
	readonly cwd?: string;
	readonly isDir: boolean;
	readonly name: string;
	readonly path: string;
};

type FileSearchResponse = {
	readonly results: WorkspaceFileSearchResult[];
};

function fileName(path: string) {
	return path.split("/").pop() || path;
}

function fileDirectory(path: string) {
	const name = fileName(path);
	return path === name ? "Project root" : path.slice(0, -(name.length + 1));
}

export function WorkspaceFileSearch({
	cwd,
	onSelect,
	placement = "shell",
}: {
	readonly cwd?: string | null;
	readonly onSelect: (file: WorkspaceFileSearchResult) => void;
	readonly placement?: "shell" | "panel";
}) {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<WorkspaceFileSearchResult[]>([]);
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
		(file: WorkspaceFileSearchResult | null) => {
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
				placement === "shell" ? styles.rootShell : styles.rootPanel,
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
					<IconSearch size={11} />
				</button>
			) : (
				<div {...stylex.props(styles.inputFrame)}>
					<IconSearch size={11} {...stylex.props(styles.searchIcon)} />
					<input
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
						styles.menu,
						placement === "panel" ? styles.menuPanel : styles.menuShell,
					)}
				>
					{placement === "panel" ? (
						<div {...stylex.props(styles.menuSearch)}>
							<IconSearch size={12} {...stylex.props(styles.searchIcon)} />
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
							<FileTypeIcon path={result.path} size={14} />
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
			) : null}
		</div>
	);
}

const styles = stylex.create({
	root: { position: "relative", minWidth: 0 },
	rootShell: { width: "clamp(190px, 24vw, 330px)", marginBottom: 4 },
	rootPanel: {
		position: "static",
		width: controlSize._6,
		flexShrink: 0,
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
	input: {
		minWidth: 0,
		flex: 1,
		borderWidth: 0,
		outline: "none",
		backgroundColor: color.transparent,
		color: color.textMain,
		fontSize: font.size_2,
		"::placeholder": { color: color.textMuted },
	},
	menu: {
		position: "absolute",
		top: "calc(100% + 5px)",
		zIndex: 300,
		display: "flex",
		maxHeight: 320,
		flexDirection: "column",
		gap: controlSize._0_5,
		overflowY: "auto",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.borderStrong,
		borderRadius: radius.lg,
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.popoverDepth,
		boxShadow: "0 18px 46px rgba(0, 0, 0, 0.64)",
		padding: controlSize._1,
	},
	menuShell: { left: 0, width: "max(100%, 330px)" },
	menuPanel: {
		left: controlSize._1,
		right: controlSize._1,
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
		minWidth: 0,
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
		minWidth: 0,
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
