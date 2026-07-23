import * as stylex from "@stylexjs/stylex";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { DropdownButton } from "../../components/ui/DropdownButton.tsx";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { IconFolder, IconPlus, IconX } from "../../components/ui/Icons.tsx";
import {
	type CustomThemeColors,
	type HexColor,
	loadCustomTheme,
	loadTerminalState,
	mutateCanonicalTerminalState,
	saveCustomTheme,
	type ThemeId,
} from "../../features/terminal/terminal-utils.ts";
import { useAsyncResource } from "../../hooks/useAsyncResource.ts";
import { useAppInfo } from "../../hooks/useAppInfo.ts";
import {
	SYNTAX_HIGHLIGHT_THEMES,
	type SyntaxHighlightTheme,
	useSyntaxHighlightTheme,
} from "../../hooks/useShikiHighlighter.ts";
import {
	APP_THEMES,
	type AppThemeId,
	applyAppTheme,
	loadAppThemeId,
	mapAppThemeToTerminalTheme,
	saveAppThemeId,
} from "../../lib/app-theme.ts";
import { CLIENT_STORAGE_CHANGED_EVENT } from "../../lib/client-storage-sync.ts";
import { APP_THEME_STORAGE_KEY } from "../../lib/client-storage-keys.ts";
import { fetchJsonOr } from "../../lib/fetch-json.ts";
import { listenWindowEvent, setInputValue } from "../../lib/react-events.ts";
import { color, controlSize, font } from "../../tokens.stylex.ts";

interface TerminalSettingsContentProps {
	themeId?: ThemeId;
	onThemeChange?: (id: ThemeId) => void;
	showVersion?: boolean;
	embedded?: boolean;
}

interface TerminalSettingsPanelProps {
	themeId: ThemeId;
	onThemeChange: (id: ThemeId) => void;
	onClose: () => void;
}

const HIDDEN_APP_THEME_IDS = new Set<AppThemeId>([
	"githubLight",
	"solarizedLight",
]);
const VISIBLE_APP_THEMES = APP_THEMES.filter(
	(theme) => !HIDDEN_APP_THEME_IDS.has(theme.id)
);
const ENABLE_CUSTOM_THEME_PICKER = false;
const EMPTY_FOLDERS: string[] = [];

function areLoadedFoldersEqual(prev: string[] | null, next: string[] | null) {
	if (prev === next) return true;
	if (!prev || !next || prev.length !== next.length) return false;
	for (let i = 0; i < prev.length; i++) {
		if (prev[i] !== next[i]) return false;
	}
	return true;
}

function ColorInput({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string;
	onChange: (v: HexColor) => void;
}) {
	return (
		<label {...stylex.props(styles.colorRow)}>
			<input
				type="color"
				value={value}
				onChange={(e) => onChange(e.target.value as HexColor)}
				{...stylex.props(styles.colorInput)}
			/>
			<span {...stylex.props(styles.mutedText)}>{label}</span>
			<span {...stylex.props(styles.colorValue)}>{value}</span>
		</label>
	);
}

function ThemeOrb({
	theme,
	selected,
	onClick,
	dashed,
}: {
	theme: {
		id: string;
		name: string;
		colors: { accent: string; black: string; darkGray: string };
	};
	selected: boolean;
	onClick: () => void;
	dashed?: boolean;
}) {
	const { accent, black, darkGray } = theme.colors;
	return (
		<button
			type="button"
			onClick={onClick}
			{...stylex.props(
				styles.themeOrbButton,
				selected && styles.themeOrbSelected
			)}
		>
			<div
				{...stylex.props(
					styles.themeOrb,
					dashed && styles.themeOrbDashed,
					selected && styles.themeOrbSelectedRing
				)}
				style={{ backgroundColor: black }}
			>
				<div
					{...stylex.props(styles.themeOrbFill)}
					style={{
						background: `radial-gradient(circle at 35% 35%, ${darkGray} 0%, ${black} 60%, ${black} 100%)`,
					}}
				/>
				<div
					{...stylex.props(styles.themeOrbGlow)}
					style={{
						top: "15%",
						left: "20%",
						width: "30%",
						height: "24%",
						background: `radial-gradient(ellipse at center, ${accent}55, transparent 70%)`,
						filter: "blur(2px)",
					}}
				/>
				<div
					{...stylex.props(styles.themeOrbHighlight)}
					style={{
						top: "18%",
						left: "24%",
						width: "22%",
						height: "18%",
						background: `radial-gradient(ellipse at center, rgba(255,255,255,0.45), transparent 70%)`,
						filter: "blur(1.5px)",
					}}
				/>
			</div>
			<span
				{...stylex.props(
					styles.themeOrbLabel,
					selected && styles.themeOrbLabelSelected
				)}
			>
				{theme.name}
			</span>
		</button>
	);
}

function SearchFoldersSection() {
	const fetchSearchFolders = useCallback(async () => {
		const data = await fetchJsonOr<{ folders: string[] }>(
			"/api/config/search-folders",
			{ folders: [] }
		);
		return data.folders;
	}, []);
	const { data: loadedFolders, setData: setFolders } = useAsyncResource<
		string[] | null
	>(fetchSearchFolders, null, { isEqual: areLoadedFoldersEqual });
	const folders = useMemo(
		() => loadedFolders ?? EMPTY_FOLDERS,
		[loadedFolders]
	);
	const [newFolder, setNewFolder] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const saveFolders = useCallback(
		async (next: string[]) => {
			setFolders(next);
			await fetch("/api/config/search-folders", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ folders: next }),
			});
		},
		[setFolders]
	);

	const addFolder = useCallback(() => {
		const trimmed = newFolder.trim();
		if (!trimmed || folders.includes(trimmed)) return;
		saveFolders([...folders, trimmed]);
		setNewFolder("");
		inputRef.current?.focus();
	}, [newFolder, folders, saveFolders]);

	const removeFolder = useCallback(
		(idx: number) => {
			saveFolders(folders.filter((_, i) => i !== idx));
		},
		[folders, saveFolders]
	);

	const browseFolder = useCallback(async () => {
		try {
			const { folder } = await fetchJsonOr<{ folder: string | null }>(
				"/api/config/pick-folder",
				{ folder: null },
				{ method: "POST" }
			);
			if (folder && !folders.includes(folder)) {
				saveFolders([...folders, folder]);
			}
		} catch {}
	}, [folders, saveFolders]);

	if (!loadedFolders) return null;

	return (
		<div {...stylex.props(styles.section)}>
			<h4 {...stylex.props(styles.sectionHeading)}>Search folders</h4>
			<p {...stylex.props(styles.sectionDescription)}>
				Directories to scan when searching for projects. Use ~/path for
				home-relative paths.
			</p>
			<div {...stylex.props(styles.folderList)}>
				{folders.map((folder, idx) => (
					<div key={folder} {...stylex.props(styles.folderRow)}>
						<span {...stylex.props(styles.folderPath)}>{folder}</span>
						<IconButton
							type="button"
							onClick={() => removeFolder(idx)}
							variant="danger"
							size="xs"
							title="Remove"
						>
							<IconX size={8} />
						</IconButton>
					</div>
				))}
			</div>
			<div {...stylex.props(styles.folderInputRow)}>
				<input
					ref={inputRef}
					type="text"
					value={newFolder}
					onChange={setInputValue.bind(null, setNewFolder)}
					onKeyDown={(e) => {
						if (e.key === "Enter") addFolder();
					}}
					placeholder="~/path/to/folder"
					{...stylex.props(styles.folderInput)}
				/>
				<Button
					type="button"
					onClick={addFolder}
					disabled={!newFolder.trim()}
					variant="secondary"
					size="sm"
					className={stylex.props(styles.folderActionButton).className}
				>
					<IconPlus size={10} />
					Add
				</Button>
				<Button
					type="button"
					onClick={browseFolder}
					variant="secondary"
					size="sm"
					className={
						stylex.props(styles.browseButton, styles.folderActionButton)
							.className
					}
				>
					<IconFolder size={10} />
					Browse
				</Button>
			</div>
		</div>
	);
}

export const TerminalSettingsContent = memo(function TerminalSettingsContent({
	themeId,
	onThemeChange,
	showVersion = true,
	embedded = false,
}: TerminalSettingsContentProps) {
	const [appThemeId, setAppThemeId] = useState<AppThemeId>(loadAppThemeId);
	const [terminalThemeId, setTerminalThemeId] = useState<ThemeId>(() => {
		const state = loadTerminalState();
		return (
			themeId ?? state?.themeId ?? mapAppThemeToTerminalTheme(loadAppThemeId())
		);
	});
	const [syntaxTheme, setSyntaxTheme] = useSyntaxHighlightTheme();
	const { data: appInfo } = useAppInfo();

	const handleThemeChange = useCallback(
		(id: AppThemeId) => {
			setAppThemeId(id);
			saveAppThemeId(id);
			applyAppTheme(id);
			const termThemeId = mapAppThemeToTerminalTheme(id);
			setTerminalThemeId(termThemeId);
			onThemeChange?.(termThemeId);
			void mutateCanonicalTerminalState(
				(state) => ({ ...state, themeId: termThemeId }),
				"theme-change"
			);
		},
		[onThemeChange]
	);

	const [custom, setCustom] = useState<CustomThemeColors>(loadCustomTheme);
	const updateCustom = useCallback(
		(patch: Partial<CustomThemeColors>) => {
			setCustom((prev) => {
				const next = { ...prev, ...patch };
				saveCustomTheme(next);
				if (terminalThemeId === "custom") {
					onThemeChange?.("custom");
					void mutateCanonicalTerminalState(
						(state) => ({ ...state, themeId: "custom" }),
						"custom-theme"
					);
				}
				return next;
			});
		},
		[terminalThemeId, onThemeChange]
	);
	useEffect(() => {
		if (themeId) setTerminalThemeId(themeId);
	}, [themeId]);
	useEffect(
		() =>
			listenWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, (event) => {
				const key = (event as CustomEvent<{ key?: string }>).detail?.key;
				if (key !== APP_THEME_STORAGE_KEY) return;
				const nextAppThemeId = loadAppThemeId();
				const nextTerminalThemeId = mapAppThemeToTerminalTheme(nextAppThemeId);
				setAppThemeId(nextAppThemeId);
				setTerminalThemeId(nextTerminalThemeId);
			}),
		[]
	);
	const isCustom = appThemeId === "custom";

	return (
		<div
			{...stylex.props(styles.panelBody, embedded && styles.panelBodyEmbedded)}
		>
			<div {...stylex.props(styles.section)}>
				<h4 {...stylex.props(styles.sectionHeading)}>Theme</h4>
				<p {...stylex.props(styles.sectionDescription)}>
					Choose the color system used across Inferay.
				</p>
				<div {...stylex.props(styles.themeGrid)}>
					{VISIBLE_APP_THEMES.map((t) => (
						<ThemeOrb
							key={t.id}
							theme={t}
							selected={appThemeId === t.id}
							onClick={() => handleThemeChange(t.id)}
						/>
					))}
					{ENABLE_CUSTOM_THEME_PICKER && (
						<ThemeOrb
							theme={{
								id: "custom",
								name: "Custom",
								colors: {
									accent: custom.cursor,
									darkGray: custom.bg,
									black: custom.bg,
								},
							}}
							selected={isCustom}
							onClick={() => handleThemeChange("custom")}
							dashed
						/>
					)}
				</div>
			</div>
			{ENABLE_CUSTOM_THEME_PICKER && isCustom && (
				<>
					<div {...stylex.props(styles.divider)} />
					<div {...stylex.props(styles.section)}>
						<h4 {...stylex.props(styles.sectionHeading, styles.customHeading)}>
							CUSTOM COLORS
						</h4>
						<div {...stylex.props(styles.colorList)}>
							<ColorInput
								label="Background"
								value={custom.bg}
								onChange={(v) => updateCustom({ bg: v })}
							/>
							<ColorInput
								label="Foreground"
								value={custom.fg}
								onChange={(v) => updateCustom({ fg: v })}
							/>
							<ColorInput
								label="Cursor"
								value={custom.cursor}
								onChange={(v) => updateCustom({ cursor: v })}
							/>
							<ColorInput
								label="Separator"
								value={custom.separator}
								onChange={(v) => updateCustom({ separator: v })}
							/>
						</div>
						<div
							{...stylex.props(styles.terminalPreview)}
							style={{ backgroundColor: custom.bg, color: custom.fg }}
						>
							<span style={{ color: custom.cursor }}>$</span> terminal-gui start
							<br />
							<span style={{ opacity: 0.6 }}>Loading…</span>
							<br />
							<span style={{ color: custom.cursor }}>✓</span> Ready
						</div>
					</div>
				</>
			)}
			<div {...stylex.props(styles.divider)} />
			<div {...stylex.props(styles.section)}>
				<h4 {...stylex.props(styles.sectionHeading)}>Diff appearance</h4>
				<p {...stylex.props(styles.sectionDescription)}>
					Syntax highlighting used by full file diffs and inline agent edit
					diffs.
				</p>
				<DropdownButton
					value={syntaxTheme}
					options={SYNTAX_HIGHLIGHT_THEMES}
					onChange={(id) => setSyntaxTheme(id as SyntaxHighlightTheme)}
					placeholder="Syntax theme"
					fullWidth
					buttonClassName={stylex.props(styles.syntaxThemeButton).className}
					labelClassName={stylex.props(styles.syntaxThemeLabel).className}
				/>
			</div>
			<div {...stylex.props(styles.divider)} />
			<SearchFoldersSection />
			{showVersion ? (
				<p {...stylex.props(styles.versionText)}>inferay {appInfo.version}</p>
			) : null}
		</div>
	);
});

export const TerminalSettingsPanel = memo(function TerminalSettingsPanel({
	themeId,
	onThemeChange,
	onClose,
}: TerminalSettingsPanelProps) {
	return (
		<div {...stylex.props(styles.overlay)}>
			<button
				type="button"
				aria-label="Close terminal settings"
				{...stylex.props(styles.backdrop)}
				onClick={onClose}
			/>
			<div {...stylex.props(styles.panel)}>
				<TerminalSettingsContent
					themeId={themeId}
					onThemeChange={onThemeChange}
				/>
			</div>
		</div>
	);
});

const styles = stylex.create({
	overlay: {
		position: "fixed",
		inset: 0,
		zIndex: 80,
		display: "flex",
		alignItems: "flex-start",
		justifyContent: "flex-end",
		backgroundColor: color.backgroundOverlay,
		padding: controlSize._4,
	},
	backdrop: {
		position: "absolute",
		inset: 0,
		borderWidth: 0,
		padding: 0,
		backgroundColor: "transparent",
	},
	panel: {
		position: "relative",
		width: "min(22rem, 100%)",
		maxHeight: "calc(100vh - 2rem)",
		overflowY: "auto",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: controlSize._3,
		backgroundColor: color.backgroundRaised,
		boxShadow: "0 24px 54px rgba(0, 0, 0, 0.64)",
	},
	panelBody: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._5,
		paddingBlock: controlSize._4,
		paddingInline: controlSize._4,
		paddingBottom: controlSize._6,
	},
	panelBodyEmbedded: {
		paddingBlock: 0,
		paddingInline: 0,
		paddingBottom: 0,
	},
	themeGrid: {
		display: "flex",
		gap: controlSize._2,
		overflowX: "auto",
		overscrollBehaviorX: "contain",
		paddingBottom: controlSize._1,
		scrollSnapType: "x proximity",
		scrollbarWidth: "none",
	},
	themeOrbButton: {
		display: "flex",
		flex: "0 0 4.5rem",
		flexDirection: "column",
		alignItems: "center",
		gap: "0.375rem",
		borderWidth: 0,
		borderRadius: controlSize._2,
		paddingBlock: controlSize._1,
		paddingInline: 0,
		scrollSnapAlign: "start",
		transitionProperty: "opacity, color",
		transitionDuration: "150ms",
		backgroundColor: "transparent",
		opacity: {
			default: 0.72,
			":hover": 1,
		},
	},
	themeOrbSelected: {
		opacity: 1,
	},
	themeOrb: {
		position: "relative",
		width: controlSize._10,
		height: controlSize._10,
		borderRadius: "999px",
	},
	themeOrbDashed: {
		borderWidth: 1,
		borderStyle: "dashed",
		borderColor: color.border,
	},
	themeOrbSelectedRing: {
		outlineColor: color.borderStrong,
		outlineOffset: controlSize._1,
		outlineStyle: "solid",
		outlineWidth: 1,
	},
	themeOrbFill: {
		position: "absolute",
		inset: 0,
		borderRadius: "999px",
		transitionProperty: "transform",
		transitionDuration: "150ms",
	},
	themeOrbGlow: {
		position: "absolute",
		borderRadius: "999px",
	},
	themeOrbHighlight: {
		position: "absolute",
		borderRadius: "999px",
	},
	themeOrbLabel: {
		color: color.textMuted,
		fontSize: font.size_1,
		lineHeight: 1,
	},
	themeOrbLabelSelected: {
		color: color.textMain,
		fontWeight: 600,
	},
	divider: {
		height: 1,
		backgroundColor: color.border,
	},
	section: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
	},
	sectionHeading: {
		margin: 0,
		color: color.textMain,
		fontSize: font.size_3,
		fontWeight: 600,
	},
	customHeading: {
		marginBottom: controlSize._3,
	},
	sectionDescription: {
		margin: 0,
		color: color.textMuted,
		fontSize: font.size_2,
		lineHeight: 1.5,
	},
	syntaxThemeButton: {
		height: controlSize._8,
		borderColor: color.border,
		backgroundColor: color.backgroundRaised,
		color: color.textSoft,
		fontSize: font.size_2,
	},
	syntaxThemeLabel: {
		fontSize: font.size_2,
	},
	colorList: {
		display: "flex",
		flexDirection: "column",
		gap: "0.625rem",
	},
	colorRow: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
	},
	colorInput: {
		width: controlSize._7,
		height: controlSize._7,
		cursor: "pointer",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: "0.25rem",
		backgroundColor: "transparent",
		padding: 0,
	},
	mutedText: {
		color: color.textMuted,
		fontSize: font.size_2,
	},
	colorValue: {
		marginLeft: "auto",
		color: color.textMuted,
		fontFamily:
			"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
		fontSize: font.size_1,
	},
	terminalPreview: {
		marginTop: controlSize._3,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: "0.375rem",
		fontFamily:
			"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
		fontSize: "0.6875rem",
		lineHeight: 1.55,
		padding: controlSize._3,
	},
	folderList: {
		display: "flex",
		maxHeight: "8rem",
		flexDirection: "column",
		gap: controlSize._1,
		overflowY: "auto",
	},
	folderRow: {
		display: "flex",
		alignItems: "center",
		gap: "0.375rem",
		borderRadius: "0.25rem",
		paddingBlock: "0.125rem",
		paddingInline: "0.375rem",
		backgroundColor: {
			default: "transparent",
			":hover": color.controlHover,
		},
	},
	folderPath: {
		minWidth: 0,
		flex: 1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textSoft,
		fontFamily:
			"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
		fontSize: font.size_2,
	},
	browseButton: {
		flexShrink: 0,
		fontSize: font.size_2,
	},
	folderActionButton: {
		flexShrink: 0,
		fontSize: font.size_2,
	},
	folderInputRow: {
		display: "flex",
		gap: "0.375rem",
		alignItems: "center",
	},
	folderInput: {
		minWidth: 0,
		flex: 1,
		height: controlSize._7,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: {
			default: color.border,
			":focus": color.borderStrong,
		},
		borderRadius: "0.375rem",
		backgroundColor: color.background,
		color: color.textSoft,
		fontSize: font.size_2,
		outline: "none",
		paddingInline: controlSize._2,
		"::placeholder": {
			color: color.textMuted,
		},
	},
	versionText: {
		color: color.textMuted,
		fontSize: font.size_1,
		textAlign: "center",
	},
});
