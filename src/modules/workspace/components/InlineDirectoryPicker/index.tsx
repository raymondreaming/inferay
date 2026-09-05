import * as stylex from "@octanejs/stylex";
import {
	useCallback,
	useDeferredValue,
	useEffect,
	useRef,
	useState,
} from "octane";
import { fetchJsonOr } from "../../../../adapters/backend/http.ts";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { useQueryResource } from "../../../../shared/hooks/useQueryResource.tsx";
import { basename, setInputValue } from "../../../../shared/lib/data.ts";
import {
	IconChevronRight,
	IconFolder,
	IconGitBranch,
	IconX,
} from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";

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
									<IconGitBranch size={iconSize._2md} />
								) : (
									<IconFolder size={iconSize._2md} />
								)}
							</span>
							<div {...stylex.props(styles.resultText)}>
								<span {...stylex.props(styles.resultName)}>{pick.name}</span>
								<span {...stylex.props(styles.resultPath)}>
									{shortenPath(pick.path)}
								</span>
							</div>
							<IconChevronRight
								size={iconSize.compact}
								{...stylex.props(styles.chevron)}
							/>
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
									<IconX size={iconSize.xs} />
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
				<div {...stylex.props(styles.inputRow)}>
					<span {...stylex.props(styles.inputIcon)}>
						<IconFolder size={iconSize.lg} />
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
										<IconGitBranch size={iconSize.md} />
									) : (
										<IconFolder size={iconSize.md} />
									)}
								</span>
								<div {...stylex.props(styles.resultText)}>
									<span {...stylex.props(styles.resultName)}>{pick.name}</span>
									<span {...stylex.props(styles.resultPathSmall)}>
										{shortenPath(pick.path)}
									</span>
								</div>
								<IconChevronRight
									size={iconSize.sm}
									{...stylex.props(styles.chevron)}
								/>
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
										<IconX size={iconSize.xs} />
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
