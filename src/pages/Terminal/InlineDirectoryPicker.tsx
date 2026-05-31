import * as stylex from "@stylexjs/stylex";
import type React from "react";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import {
	IconChevronRight,
	IconFolder,
	IconGitBranch,
	IconX,
} from "../../components/ui/Icons.tsx";
import { useAsyncResource } from "../../hooks/useAsyncResource.ts";
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
}

export function InlineDirectoryPicker({
	onSelect,
	onCancel,
	multiSelect,
	onMultiSelect,
	hideInput,
	onSelectionChange,
	showStartButton = true,
}: InlineDirectoryPickerProps) {
	const [query, setQuery] = useState("");
	const deferredQuery = useDeferredValue(query.trim());
	const { data: pickerData } = useAsyncResource(
		async () => {
			const data = await fetchJsonOr<{
				quickPicks?: QuickPick[];
				home?: string;
			}>("/api/terminal/directories?quickPicks=true", {});
			return {
				quickPicks: data.quickPicks || [],
				homePath: data.home || "",
			};
		},
		{ quickPicks: [], homePath: "" },
		[]
	);
	const { data: searchResults, loading: searchLoading } = useAsyncResource<
		QuickPick[]
	>(
		async () => {
			if (!deferredQuery) return [];
			const data = await fetchJsonOr<{
				directories?: Array<{ name: string; path: string }>;
			}>(
				`/api/terminal/directories?q=${encodeURIComponent(deferredQuery)}`,
				{}
			);
			return (data.directories || []).map((d) => ({
				name: d.name,
				path: d.path,
				isGitRepo: false,
			}));
		},
		[],
		[deferredQuery]
	);
	const [selectedIndexValue, setSelectedIndex] = useState(-1);
	const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
	const inputRef = useRef<HTMLInputElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const isSearching = query.trim().length > 0;
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
		setSelectedPaths((prev) => {
			const next = prev.includes(path)
				? prev.filter((p) => p !== path)
				: [...prev, path];
			onSelectionChange?.(next);
			return next;
		});
	};

	const handleItemClick = (path: string) => {
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

	const handleKeyDown = (e: React.KeyboardEvent) => {
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
				current < 0 ? itemCount - 1 : (current - 1 + itemCount) % itemCount
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
								i === selectedIndex && styles.resultRowActive
							)}
						>
							<span
								{...stylex.props(
									styles.resultIcon,
									i === selectedIndex && styles.accentText
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
			<div {...stylex.props(styles.unifiedFrame)}>
				{showResults && itemCount > 0 && (
					<div {...stylex.props(styles.unifiedList)}>
						{displayList.map((pick, i) => (
							<button
								type="button"
								key={pick.path}
								onMouseDown={(e) => e.preventDefault()}
								onClick={handleItemClick.bind(null, pick.path)}
								{...stylex.props(
									styles.resultRowCompact,
									i === selectedIndex && styles.resultRowActiveAccent
								)}
							>
								<span
									{...stylex.props(
										styles.resultIcon,
										i === selectedIndex && styles.accentText
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
				<div {...stylex.props(styles.inputRow)}>
					<span {...stylex.props(styles.inputIcon)}>
						<IconFolder size={14} />
					</span>
					<input
						ref={inputRef}
						type="text"
						value={query}
						onChange={setInputValue.bind(null, setQuery)}
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
		borderTopWidth: 1,
		borderTopStyle: "solid",
		borderTopColor: "rgba(255, 255, 255, 0.06)",
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
		borderRadius: "0.25rem",
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
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: "rgba(255, 255, 255, 0.06)",
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
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
	unifiedList: {
		display: "flex",
		flexDirection: "column",
		minWidth: 0,
		maxHeight: "220px",
		overflowY: "auto",
		paddingBlock: 0,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: "rgba(255, 255, 255, 0.06)",
	},
	resultRowCompact: {
		display: "flex",
		width: "100%",
		minWidth: 0,
		alignItems: "center",
		gap: controlSize._2,
		color: color.textSoft,
		paddingBlock: "0.1875rem",
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
	inputRow: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
		minWidth: 0,
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._3,
	},
	inputIcon: {
		flexShrink: 0,
		color: color.textMuted,
	},
	input: {
		minWidth: 0,
		flex: 1,
		backgroundColor: "transparent",
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
