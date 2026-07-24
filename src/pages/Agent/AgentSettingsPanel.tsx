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
	loadAgentState,
	mutateCanonicalAgentState,
	saveCustomTheme,
	type ThemeId,
} from "../../features/agent/agent-utils.ts";
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
	isDarkProductTheme,
	loadAppThemeId,
	mapAppThemeToAgentTheme,
	saveAppThemeId,
} from "../../lib/app-theme.ts";
import {
	APP_BACKGROUNDS,
	type AppBackgroundId,
	type AppBackgroundSettings,
	loadAppBackgroundSettings,
	saveAppBackgroundSettings,
} from "../../lib/app-background.ts";
import { CLIENT_STORAGE_CHANGED_EVENT } from "../../lib/client-storage-sync.ts";
import {
	APP_BACKGROUND_STORAGE_KEY,
	APP_THEME_STORAGE_KEY,
} from "../../lib/client-storage-keys.ts";
import { fetchJsonOr, resolveServerUrl } from "../../lib/fetch-json.ts";
import { listenWindowEvent, setInputValue } from "../../lib/react-events.ts";
import { color, controlSize, font } from "../../tokens.stylex.ts";

interface AgentSettingsContentProps {
	themeId?: ThemeId;
	onThemeChange?: (id: ThemeId) => void;
	showVersion?: boolean;
	embedded?: boolean;
}

interface AgentSettingsPanelProps {
	themeId: ThemeId;
	onThemeChange: (id: ThemeId) => void;
	onClose: () => void;
}

const VISIBLE_APP_THEMES = APP_THEMES.filter((theme) =>
	isDarkProductTheme(theme.id)
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

function BackgroundScenePicker() {
	const [background, setBackground] = useState<AppBackgroundSettings>(
		loadAppBackgroundSettings
	);
	const [uploading, setUploading] = useState(false);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	useEffect(
		() =>
			listenWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, (event) => {
				const key = (event as CustomEvent<{ key?: string }>).detail?.key;
				if (key === APP_BACKGROUND_STORAGE_KEY) {
					setBackground(loadAppBackgroundSettings());
				}
			}),
		[]
	);

	const updateBackground = useCallback(
		(patch: Partial<AppBackgroundSettings>) => {
			setBackground((current) => {
				const next = { ...current, ...patch };
				saveAppBackgroundSettings(next);
				return next;
			});
		},
		[]
	);

	const uploadCustomBackground = useCallback(
		async (file: File | null) => {
			if (!file) return;
			setUploading(true);
			setUploadError(null);
			try {
				const formData = new FormData();
				formData.append("file", file);
				const response = await fetch("/api/config/background-image", {
					method: "POST",
					body: formData,
				});
				if (!response.ok) {
					throw new Error(
						(await response.text()) || "Could not import that image"
					);
				}
				const payload = (await response.json()) as { revision?: number };
				updateBackground({
					id: "custom",
					autoTheme: true,
					customRevision: payload.revision ?? Date.now(),
				});
			} catch (error) {
				setUploadError(
					error instanceof Error ? error.message : "Could not import that image"
				);
			} finally {
				setUploading(false);
				if (fileInputRef.current) fileInputRef.current.value = "";
			}
		},
		[updateBackground]
	);

	const scenes: Array<{
		id: AppBackgroundId;
		name: string;
		path: string | null;
	}> = [
		...APP_BACKGROUNDS,
		{
			id: "custom",
			name: "Your image",
			path:
				background.customRevision > 0
					? `/api/config/background-image?v=${background.customRevision}`
					: null,
		},
		{ id: "none", name: "No scene", path: null },
	];

	return (
		<div {...stylex.props(styles.section)}>
			<div {...stylex.props(styles.backgroundHeadingRow)}>
				<div>
					<h4 {...stylex.props(styles.sectionHeading)}>Background world</h4>
					<p {...stylex.props(styles.sectionDescription)}>
						Choose a built-in scene or bring your own image.
					</p>
				</div>
				<Button
					type="button"
					size="sm"
					variant="secondary"
					onClick={() => fileInputRef.current?.click()}
					disabled={uploading}
				>
					<IconFolder size={10} />
					{uploading ? "Importing…" : "Choose image"}
				</Button>
				<input
					ref={fileInputRef}
					type="file"
					accept="image/png,image/jpeg,image/webp,image/gif"
					onChange={(event) =>
						void uploadCustomBackground(event.currentTarget.files?.[0] ?? null)
					}
					{...stylex.props(styles.hiddenFileInput)}
				/>
			</div>
			<div {...stylex.props(styles.backgroundGrid)}>
				{scenes.map((scene) => {
					const selected = background.id === scene.id;
					return (
						<button
							key={scene.id}
							type="button"
							onClick={() =>
								scene.id === "custom" && background.customRevision === 0
									? fileInputRef.current?.click()
									: updateBackground({
											id: scene.id,
											autoTheme: scene.id !== "none",
										})
							}
							{...stylex.props(
								styles.backgroundCard,
								selected && styles.backgroundCardSelected
							)}
						>
							<span
								{...stylex.props(styles.backgroundPreview)}
								style={{
									backgroundImage: scene.path
										? `linear-gradient(rgba(2,3,8,.12), rgba(2,3,8,.32)), url("${resolveServerUrl(scene.path)}")`
										: scene.id === "none"
											? "radial-gradient(circle at 35% 30%, #252632, #050506 70%)"
											: "linear-gradient(135deg, #272938, #0a0b10)",
								}}
							/>
							<span {...stylex.props(styles.backgroundName)}>{scene.name}</span>
						</button>
					);
				})}
			</div>
			{uploadError ? (
				<p {...stylex.props(styles.backgroundError)}>{uploadError}</p>
			) : null}
			<div {...stylex.props(styles.backgroundControls)}>
				<div {...stylex.props(styles.backgroundAutoTheme)}>
					<span>
						<strong {...stylex.props(styles.backgroundAutoTitle)}>
							Interface color source
						</strong>
						<small {...stylex.props(styles.backgroundAutoDescription)}>
							Use your chosen theme or softly match the selected scene.
						</small>
					</span>
					<div {...stylex.props(styles.colorSourceOptions)}>
						<button
							type="button"
							onClick={() => updateBackground({ autoTheme: false })}
							{...stylex.props(
								styles.colorSourceButton,
								!background.autoTheme && styles.colorSourceButtonSelected
							)}
						>
							Theme
						</button>
						<button
							type="button"
							disabled={background.id === "none"}
							onClick={() => updateBackground({ autoTheme: true })}
							{...stylex.props(
								styles.colorSourceButton,
								background.autoTheme && styles.colorSourceButtonSelected
							)}
						>
							Scene
						</button>
					</div>
				</div>
				<label {...stylex.props(styles.backgroundControl)}>
					<span>Darkness</span>
					<input
						type="range"
						min="0"
						max="85"
						value={background.dim}
						{...stylex.props(styles.backgroundRange)}
						onChange={(event) =>
							updateBackground({ dim: Number(event.currentTarget.value) })
						}
					/>
					<span {...stylex.props(styles.backgroundValue)}>
						{background.dim}%
					</span>
				</label>
				<label {...stylex.props(styles.backgroundControl)}>
					<span>Image softness</span>
					<input
						type="range"
						min="0"
						max="20"
						value={background.blur}
						{...stylex.props(styles.backgroundRange)}
						onChange={(event) =>
							updateBackground({ blur: Number(event.currentTarget.value) })
						}
					/>
					<span {...stylex.props(styles.backgroundValue)}>
						{background.blur}px
					</span>
				</label>
				<label {...stylex.props(styles.backgroundControl)}>
					<span>Glass softness</span>
					<input
						type="range"
						min="0"
						max="16"
						value={background.glassBlur}
						{...stylex.props(styles.backgroundRange)}
						onChange={(event) =>
							updateBackground({
								glassBlur: Number(event.currentTarget.value),
							})
						}
					/>
					<span {...stylex.props(styles.backgroundValue)}>
						{background.glassBlur}px
					</span>
				</label>
			</div>
		</div>
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

export const AgentSettingsContent = memo(function AgentSettingsContent({
	themeId,
	onThemeChange,
	showVersion = true,
	embedded = false,
}: AgentSettingsContentProps) {
	const [appThemeId, setAppThemeId] = useState<AppThemeId>(loadAppThemeId);
	const [backgroundAutoTheme, setBackgroundAutoTheme] = useState(
		() => loadAppBackgroundSettings().autoTheme
	);
	const [agentThemeId, setAgentThemeId] = useState<ThemeId>(() => {
		const state = loadAgentState();
		return (
			themeId ?? state?.themeId ?? mapAppThemeToAgentTheme(loadAppThemeId())
		);
	});
	const [syntaxTheme, setSyntaxTheme] = useSyntaxHighlightTheme();
	const { data: appInfo } = useAppInfo();

	const handleThemeChange = useCallback(
		(id: AppThemeId) => {
			setAppThemeId(id);
			saveAppThemeId(id);
			const background = loadAppBackgroundSettings();
			if (background.autoTheme) {
				saveAppBackgroundSettings({ ...background, autoTheme: false });
			}
			setBackgroundAutoTheme(false);
			applyAppTheme(id);
			const termThemeId = mapAppThemeToAgentTheme(id);
			setAgentThemeId(termThemeId);
			onThemeChange?.(termThemeId);
			void mutateCanonicalAgentState(
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
				if (agentThemeId === "custom") {
					onThemeChange?.("custom");
					void mutateCanonicalAgentState(
						(state) => ({ ...state, themeId: "custom" }),
						"custom-theme"
					);
				}
				return next;
			});
		},
		[agentThemeId, onThemeChange]
	);
	useEffect(() => {
		if (themeId) setAgentThemeId(themeId);
	}, [themeId]);
	useEffect(
		() =>
			listenWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, (event) => {
				const key = (event as CustomEvent<{ key?: string }>).detail?.key;
				if (key === APP_BACKGROUND_STORAGE_KEY) {
					setBackgroundAutoTheme(loadAppBackgroundSettings().autoTheme);
				}
				if (key === APP_THEME_STORAGE_KEY) {
					const nextAppThemeId = loadAppThemeId();
					const nextAgentThemeId = mapAppThemeToAgentTheme(nextAppThemeId);
					setAppThemeId(nextAppThemeId);
					setAgentThemeId(nextAgentThemeId);
				}
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
					Choose the color system used across Inferay. Selecting one makes Theme
					the interface color source.
				</p>
				<div {...stylex.props(styles.themeGrid)}>
					{VISIBLE_APP_THEMES.map((t) => (
						<ThemeOrb
							key={t.id}
							theme={t}
							selected={!backgroundAutoTheme && appThemeId === t.id}
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
							selected={!backgroundAutoTheme && isCustom}
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
							{...stylex.props(styles.agentPreview)}
							style={{ backgroundColor: custom.bg, color: custom.fg }}
						>
							<span style={{ color: custom.cursor }}>$</span> agent-gui start
							<br />
							<span style={{ opacity: 0.6 }}>Loading…</span>
							<br />
							<span style={{ color: custom.cursor }}>✓</span> Ready
						</div>
					</div>
				</>
			)}
			<div {...stylex.props(styles.divider)} />
			<BackgroundScenePicker />
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

export const AgentSettingsPanel = memo(function AgentSettingsPanel({
	themeId,
	onThemeChange,
	onClose,
}: AgentSettingsPanelProps) {
	return (
		<div {...stylex.props(styles.overlay)}>
			<button
				type="button"
				aria-label="Close agent settings"
				{...stylex.props(styles.backdrop)}
				onClick={onClose}
			/>
			<div {...stylex.props(styles.panel)}>
				<AgentSettingsContent themeId={themeId} onThemeChange={onThemeChange} />
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
	backgroundHeadingRow: {
		alignItems: "flex-start",
		display: "flex",
		gap: controlSize._3,
		justifyContent: "space-between",
	},
	hiddenFileInput: {
		display: "none",
	},
	backgroundGrid: {
		display: "grid",
		gap: controlSize._2,
		gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
	},
	backgroundCard: {
		backgroundColor: "rgba(255,255,255,0.025)",
		borderColor: color.border,
		borderRadius: controlSize._2,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textMuted,
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1_5,
		overflow: "hidden",
		padding: controlSize._1,
		textAlign: "left",
		transitionDuration: "150ms",
		transitionProperty: "border-color, background-color, color, transform",
		":hover": {
			backgroundColor: color.surfaceSubtle,
			borderColor: color.borderStrong,
			color: color.textMain,
			transform: "translateY(-1px)",
		},
	},
	backgroundCardSelected: {
		backgroundColor: color.surfaceSubtle,
		borderColor: color.accent,
		color: color.textMain,
	},
	backgroundPreview: {
		backgroundColor: color.background,
		backgroundPosition: "center",
		backgroundRepeat: "no-repeat",
		backgroundSize: "cover",
		borderRadius: 5,
		display: "block",
		height: 64,
		width: "100%",
	},
	backgroundName: {
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		paddingInline: controlSize._1,
		paddingBottom: controlSize._1,
	},
	backgroundError: {
		color: color.danger,
		fontSize: font.size_2,
		lineHeight: 1.4,
		margin: 0,
	},
	backgroundControls: {
		backgroundColor: "rgba(255,255,255,0.025)",
		borderColor: color.border,
		borderRadius: controlSize._2,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
		padding: controlSize._2,
	},
	backgroundAutoTheme: {
		alignItems: "center",
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		color: color.textSoft,
		display: "flex",
		fontSize: font.size_2,
		gap: controlSize._2,
		justifyContent: "space-between",
		paddingBottom: controlSize._2,
	},
	backgroundAutoTitle: {
		display: "block",
		fontWeight: font.weight_5,
	},
	backgroundAutoDescription: {
		color: color.textMuted,
		display: "block",
		fontSize: font.size_1,
		lineHeight: 1.35,
		marginTop: 2,
	},
	colorSourceOptions: {
		backgroundColor: color.surfaceInset,
		borderColor: color.border,
		borderRadius: controlSize._1_5,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		flexShrink: 0,
		gap: 2,
		padding: 2,
	},
	colorSourceButton: {
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlActive,
		},
		borderWidth: 0,
		borderRadius: controlSize._1,
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		minHeight: controlSize._6,
		paddingInline: controlSize._2,
		":disabled": {
			opacity: 0.35,
		},
	},
	colorSourceButtonSelected: {
		backgroundColor: color.backgroundRaised,
		color: color.textMain,
	},
	backgroundControl: {
		alignItems: "center",
		color: color.textMuted,
		display: "grid",
		fontSize: font.size_2,
		gap: controlSize._2,
		gridTemplateColumns: "6.5rem 1fr 2.5rem",
	},
	backgroundRange: {
		accentColor: color.accent,
		margin: 0,
		width: "100%",
	},
	backgroundValue: {
		color: color.textSoft,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		textAlign: "right",
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
	agentPreview: {
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
