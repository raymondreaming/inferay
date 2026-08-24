import * as stylex from "@octanejs/stylex";
import {
	useCallback,
	useDeferredValue,
	useEffect,
	useRef,
	useState,
} from "octane";
import {
	IconChevronRight,
	IconFolder,
	IconGitBranch,
	IconX,
} from "../../components/ui/Icons.tsx";
import { useQueryResource } from "../../hooks/useQueryResource.tsx";
import { fetchJsonOr } from "../../lib/fetch-json.ts";
import { basename } from "../../lib/format.ts";
import { setInputValue } from "../../lib/react-events.ts";
import {
	color,
	controlSize,
	effect,
	font,
	shadow,
} from "../../tokens.stylex.ts";

interface QuickPick {
	name: string;
	path: string;
	isGitRepo: boolean;
}

interface InlineDirectoryPickerProps {
	onSelect: (path: string | null) => void;
	onCancel?: () => void;
	multiSelect?: boolean;
	onMultiSelect?: (paths: string[]) => void;
	hideInput?: boolean;
	onSelectionChange?: (paths: string[]) => void;
	showStartButton?: boolean;
	liquidSurface?: boolean;
}

function areQuickPicksEqual(prev: QuickPick[], next: QuickPick[]) {
	if (prev.length !== next.length) return false;
	for (let i = 0; i < prev.length; i++) {
		const a = prev[i]!;
		const b = next[i]!;
		if (a.name !== b.name || a.path !== b.path || a.isGitRepo !== b.isGitRepo)
			return false;
	}
	return true;
}

function arePickerDataEqual(
	prev: { quickPicks: QuickPick[]; homePath: string },
	next: { quickPicks: QuickPick[]; homePath: string },
) {
	return (
		prev.homePath === next.homePath &&
		areQuickPicksEqual(prev.quickPicks, next.quickPicks)
	);
}

export function InlineDirectoryPicker({
	onSelect,
	onCancel,
	multiSelect,
	onMultiSelect,
	hideInput,
	onSelectionChange,
	showStartButton = true,
	liquidSurface = false,
}: InlineDirectoryPickerProps) {
	const [query, setQuery] = useState("");
	const deferredQuery = useDeferredValue(query.trim());
	const fetchPickerData = useCallback(async () => {
		const data = await fetchJsonOr<{
			quickPicks?: QuickPick[];
			home?: string;
		}>("/api/agent/directories?quickPicks=true", {});
		return {
			quickPicks: data.quickPicks || [],
			homePath: data.home || "",
		};
	}, []);
	const { data: pickerData } = useQueryResource(
		fetchPickerData,
		{
			quickPicks: [],
			homePath: "",
		},
		{
			queryKey: ["agent", "directories", "quick"],
			isEqual: arePickerDataEqual,
		},
	);
	const fetchSearchResults = useCallback(async () => {
		if (!deferredQuery) return [];
		const data = await fetchJsonOr<{
			directories?: Array<{ name: string; path: string }>;
		}>(`/api/agent/directories?q=${encodeURIComponent(deferredQuery)}`, {});
		return (data.directories || []).map((d) => ({
			name: d.name,
			path: d.path,
			isGitRepo: false,
		}));
	}, [deferredQuery]);
	const { data: searchResults, loading: searchLoading } = useQueryResource<
		QuickPick[]
	>(fetchSearchResults, [], {
		queryKey: ["agent", "directories", "search", deferredQuery],
		isEqual: areQuickPicksEqual,
	});
	const [selectedIndexValue, setSelectedIndex] = useState(-1);
	const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const isSearching = deferredQuery.length > 0;
	const displayList = (isSearching ? searchResults : pickerData.quickPicks)
		.filter((p) => !multiSelect || !selectedPaths.includes(p.path))
		.slice(0, 5);
	const itemCount = displayList.length;
	const selectedIndex =
		itemCount === 0
			? -1
			: selectedIndexValue < 0
				? 0
				: Math.min(selectedIndexValue, itemCount - 1);
	const loading = isSearching && searchLoading;

	useEffect(() => {
		const timer = setTimeout(() => inputRef.current?.focus(), 10);
		return () => {
			clearTimeout(timer);
		};
	}, []);

	const togglePath = (path: string) => {
		const next = selectedPaths.includes(path)
			? selectedPaths.filter((p) => p !== path)
			: [...selectedPaths, path];
		setSelectedPaths(next);
		onSelectionChange?.(next);
	};

	const handleItemClick = (path: string) => {
		setSelectedIndex(-1);
		if (multiSelect) {
			togglePath(path);
			setQuery("");
		} else {
			onSelect(path);
		}
	};

	const handleStart = () => {
		if (selectedPaths.length > 0 && onMultiSelect) {
			onMultiSelect(selectedPaths);
		} else if (selectedPaths.length === 1) {
			onSelect(selectedPaths[0]!);
		}
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (itemCount === 0) {
			if (e.key === "Escape") {
				e.preventDefault();
				onCancel?.();
			}
			return;
		}
		if (e.key === "ArrowDown" || e.key === "Tab") {
			e.preventDefault();
			setSelectedIndex((current) => (current + 1) % itemCount);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setSelectedIndex((current) =>
				current < 0 ? itemCount - 1 : (current - 1 + itemCount) % itemCount,
			);
		} else if (e.key === "Enter") {
			e.preventDefault();
			const idx = selectedIndex >= 0 ? selectedIndex : 0;
			const path = displayList[idx]?.path;
			if (path) handleItemClick(path);
		} else if (e.key === "Escape") {
			e.preventDefault();
			onCancel?.();
		}
	};

	const shortenPath = (path: string) => {
		if (pickerData.homePath && path.startsWith(pickerData.homePath)) {
			return `~${path.slice(pickerData.homePath.length)}`;
		}
		return path;
	};

	const showResults = true;
	if (hideInput) {
		return (
			<div {...stylex.props(styles.compactRoot)}>
				<div {...stylex.props(styles.compactList)}>
					{displayList.map((pick, i) => (
						<button
							type="button"
							key={pick.path}
							onClick={handleItemClick.bind(null, pick.path)}
							{...stylex.props(
								styles.resultRow,
								i === selectedIndex && styles.resultRowActive,
							)}
						>
							<span
								{...stylex.props(
									styles.resultIcon,
									i === selectedIndex && styles.accentText,
								)}
							>
								{pick.isGitRepo ? (
									<IconGitBranch size={13} />
								) : (
									<IconFolder size={13} />
								)}
							</span>
							<div {...stylex.props(styles.resultText)}>
								<span {...stylex.props(styles.resultName)}>{pick.name}</span>
								<span {...stylex.props(styles.resultPath)}>
									{shortenPath(pick.path)}
								</span>
							</div>
							<IconChevronRight size={11} {...stylex.props(styles.chevron)} />
						</button>
					))}
				</div>
				{multiSelect && selectedPaths.length > 0 && (
					<div {...stylex.props(styles.selectedBar)}>
						{selectedPaths.slice(0, 4).map((p) => (
							<span key={p} {...stylex.props(styles.selectedTag)}>
								<span {...stylex.props(styles.truncate)}>{basename(p)}</span>
								<button
									type="button"
									onClick={togglePath.bind(null, p)}
									{...stylex.props(styles.tagRemove)}
								>
									<IconX size={8} />
								</button>
							</span>
						))}
						{selectedPaths.length > 4 && (
							<span {...stylex.props(styles.moreCount)}>
								+{selectedPaths.length - 4}
							</span>
						)}
					</div>
				)}
			</div>
		);
	}

	return (
		<div {...stylex.props(styles.root)} ref={containerRef}>
			<div
				{...stylex.props(
					styles.unifiedFrame,
					liquidSurface && styles.unifiedFrameLiquid,
				)}
			>
				<div {...stylex.props(styles.inputRow)}>
					<span {...stylex.props(styles.inputIcon)}>
						<IconFolder size={14} />
					</span>
					<input
						ref={inputRef}
						type="text"
						value={query}
						onInput={(event) => {
							setInputValue(setQuery, event);
							setSelectedIndex(-1);
						}}
						onKeyDown={handleKeyDown}
						placeholder="Search folder..."
						autoComplete="off"
						autoCorrect="off"
						autoCapitalize="off"
						spellCheck={false}
						{...stylex.props(styles.input)}
					/>
					{loading && <div {...stylex.props(styles.spinner)} />}
					{showStartButton && multiSelect && selectedPaths.length > 0 && (
						<button
							type="button"
							onClick={handleStart}
							{...stylex.props(styles.startButton)}
						>
							Start
							{selectedPaths.length > 1 ? ` (${selectedPaths.length})` : ""}
						</button>
					)}
				</div>
				{showResults && itemCount > 0 && (
					<div {...stylex.props(styles.unifiedList)}>
						{displayList.map((pick, i) => (
							<button
								type="button"
								key={pick.path}
								onMouseDown={(e) => e.preventDefault()}
								onMouseMove={() => setSelectedIndex(i)}
								onClick={handleItemClick.bind(null, pick.path)}
								{...stylex.props(
									styles.resultRowCompact,
									selectedIndexValue >= 0 &&
										i === selectedIndex &&
										styles.resultRowActiveAccent,
								)}
							>
								<span
									{...stylex.props(
										styles.resultIcon,
										i === selectedIndex && styles.accentText,
									)}
								>
									{pick.isGitRepo ? (
										<IconGitBranch size={12} />
									) : (
										<IconFolder size={12} />
									)}
								</span>
								<div {...stylex.props(styles.resultText)}>
									<span {...stylex.props(styles.resultName)}>{pick.name}</span>
									<span {...stylex.props(styles.resultPathSmall)}>
										{shortenPath(pick.path)}
									</span>
								</div>
								<IconChevronRight size={10} {...stylex.props(styles.chevron)} />
							</button>
						))}
					</div>
				)}
				{multiSelect && selectedPaths.length > 0 && (
					<div {...stylex.props(styles.selectedWrap)}>
						<div {...stylex.props(styles.selectedList)}>
							{selectedPaths.map((p, i) => (
								<span key={p} {...stylex.props(styles.selectedTagStrong)}>
									{i === 0 ? "● " : ""}
									{basename(p)}
									<button
										type="button"
										onClick={togglePath.bind(null, p)}
										{...stylex.props(styles.tagRemove)}
									>
										<IconX size={8} />
									</button>
								</span>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

const styles = stylex.create({
	root: {
		boxSizing: "border-box",
		maxWidth: "100%",
		minWidth: 0,
		overflow: "hidden",
		position: "relative",
		width: "100%",
	},
	compactRoot: {
		boxSizing: "border-box",
		maxWidth: "100%",
		minWidth: 0,
		overflow: "hidden",
		width: "100%",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: controlSize._3,
		backgroundColor: "rgba(28, 28, 30, 0.95)",
		backgroundImage: effect.popoverDepth,
		boxShadow:
			"inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 24px 54px rgba(0, 0, 0, 0.64)",
	},
	compactList: {
		maxHeight: "210px",
		overflowY: "auto",
		paddingBlock: 0,
	},
	resultRow: {
		display: "flex",
		width: "100%",
		alignItems: "center",
		gap: controlSize._2,
		color: color.textSoft,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
		textAlign: "left",
		transitionProperty: "background-color, color",
		transitionDuration: "120ms",
		backgroundColor: {
			default: "transparent",
			":hover": color.controlHover,
		},
		backgroundImage: {
			default: "none",
			":hover": effect.controlDepth,
		},
	},
	resultRowActive: {
		backgroundColor: color.controlHover,
		backgroundImage: effect.controlDepth,
		color: color.textMain,
	},
	resultRowActiveAccent: {
		backgroundColor: color.controlActive,
		backgroundImage: effect.controlDepthHover,
		color: color.textMain,
	},
	resultIcon: {
		flexShrink: 0,
		color: color.textMuted,
	},
	accentText: {
		color: color.textSoft,
	},
	resultText: {
		minWidth: 0,
		flex: 1,
	},
	resultName: {
		display: "block",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		fontSize: font.size_3,
		fontWeight: font.weight_5,
	},
	resultPath: {
		display: "block",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontSize: font.size_2,
	},
	resultPathSmall: {
		display: "block",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontSize: font.size_1,
	},
	chevron: {
		flexShrink: 0,
		color: color.textMuted,
	},
	selectedBar: {
		display: "flex",
		minWidth: 0,
		flexWrap: "wrap",
		gap: controlSize._1,
		overflow: "hidden",
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
	},
	selectedTag: {
		display: "inline-flex",
		maxWidth: "140px",
		alignItems: "center",
		gap: controlSize._1,
		borderRadius: "0.375rem",
		backgroundColor: "rgba(255, 255, 255, 0.05)",
		backgroundImage: effect.controlDepth,
		color: color.textSoft,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		paddingBlock: "0.125rem",
		paddingInline: "0.375rem",
	},
	selectedTagStrong: {
		display: "inline-flex",
		alignItems: "center",
		gap: controlSize._1,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: controlSize._2,
		backgroundColor: color.controlActive,
		backgroundImage: effect.controlDepth,
		color: color.textSoft,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		paddingBlock: "0.125rem",
		paddingInline: "0.375rem",
	},
	truncate: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	tagRemove: {
		flexShrink: 0,
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		transitionProperty: "color",
		transitionDuration: "120ms",
	},
	moreCount: {
		color: color.textMuted,
		fontSize: font.size_1,
	},
	spinner: {
		width: font.size_3,
		height: font.size_3,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.textMuted,
		borderTopColor: "transparent",
		borderRadius: "999px",
		animationName: stylex.keyframes({
			to: {
				transform: "rotate(360deg)",
			},
		}),
		animationDuration: "800ms",
		animationTimingFunction: "linear",
		animationIterationCount: "infinite",
	},
	selectedWrap: {
		borderBlockWidth: 0,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._2,
	},
	selectedList: {
		display: "flex",
		maxHeight: "60px",
		flexWrap: "wrap",
		gap: controlSize._1,
		overflowY: "auto",
	},
	unifiedFrame: {
		boxSizing: "border-box",
		display: "flex",
		flexDirection: "column",
		maxWidth: "100%",
		minWidth: 0,
		width: "100%",
		overflow: "hidden",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: controlSize._3,
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.popoverDepth,
		boxShadow:
			"inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 24px 54px rgba(0, 0, 0, 0.64)",
	},
	unifiedFrameLiquid: {
		backgroundColor: color.transparent,
		backgroundImage: "none",
		borderColor: color.transparent,
		boxShadow: "none",
		padding: controlSize._1,
	},
	unifiedList: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._0_5,
		minWidth: 0,
		maxHeight: "220px",
		overflowY: "auto",
		borderBlockWidth: 0,
		paddingBlock: controlSize._0_5,
	},
	resultRowCompact: {
		display: "flex",
		width: "100%",
		minWidth: 0,
		alignItems: "center",
		borderRadius: controlSize._2,
		gap: controlSize._2,
		color: color.textSoft,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
		textAlign: "left",
		transitionProperty: "background-color, color",
		transitionDuration: "120ms",
		backgroundColor: "transparent",
		backgroundImage: "none",
	},
	inputRow: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
		minWidth: 0,
		borderBlockWidth: 0,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._2,
	},
	inputIcon: {
		flexShrink: 0,
		color: color.textMuted,
	},
	input: {
		minWidth: 0,
		flex: 1,
		backgroundColor: "transparent",
		borderWidth: 0,
		color: color.textMain,
		fontSize: "0.8125rem",
		outline: "none",
		"::placeholder": {
			color: color.textMuted,
		},
	},
	startButton: {
		flexShrink: 0,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: "0.375rem",
		backgroundColor: color.controlActive,
		backgroundImage: effect.controlDepth,
		boxShadow: shadow.controlDepth,
		color: color.textSoft,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		paddingBlock: "0.125rem",
		paddingInline: controlSize._2,
		transitionProperty: "background-color, color",
		transitionDuration: "120ms",
		":hover": {
			backgroundColor: color.controlHover,
		},
	},
});
