import * as stylex from "@octanejs/stylex";
import {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "octane";
import { Button } from "../../components/ui/Button.tsx";
import { DropdownButton } from "../../components/ui/DropdownButton.tsx";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { IconFolder, IconPlus, IconX } from "../../components/ui/Icons.tsx";
import { iconSize } from "../../design-system.ts";
import {
	type CustomThemeColors,
	dispatchAgentShellChange,
	type HexColor,
	loadAgentLayoutMode,
	loadAgentState,
	loadCustomTheme,
	mutateCanonicalAgentState,
	saveCustomTheme,
	type ThemeId,
} from "../../features/agent/agent-utils.ts";
import type { EffectiveAgentContext } from "../../features/agent-context/types.ts";
import { useAppInfo } from "../../hooks/useAppInfo.ts";
import { useQueryResource } from "../../hooks/useQueryResource.tsx";
import {
	SYNTAX_HIGHLIGHT_THEMES,
	type SyntaxHighlightTheme,
	useSyntaxHighlightTheme,
} from "../../hooks/useShikiHighlighter.tsx";
import {
	APP_BACKGROUNDS,
	type AppBackgroundId,
	type AppBackgroundSettings,
	loadAppBackgroundSettings,
	saveAppBackgroundSettings,
} from "../../lib/app-background.ts";
import {
	APP_FONTS,
	type AppFontId,
	applyAppFont,
	loadAppFontId,
	saveAppFontId,
} from "../../lib/app-font.ts";
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
	APP_BACKGROUND_STORAGE_KEY,
	APP_THEME_STORAGE_KEY,
} from "../../lib/client-storage-keys.ts";
import { CLIENT_STORAGE_CHANGED_EVENT } from "../../lib/client-storage-sync.ts";
import {
	fetchJson,
	fetchJsonOr,
	postJson,
	resolveServerUrl,
} from "../../lib/fetch-json.ts";
import { listenWindowEvent, setInputValue } from "../../lib/react-events.ts";
import { writeStoredValue } from "../../lib/stored-json.ts";
import {
	color,
	controlSize,
	font,
	layer,
	motion,
	radius,
} from "../../tokens.stylex.ts";

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
	isDarkProductTheme(theme.id),
);
const ENABLE_CUSTOM_THEME_PICKER = false;
const EMPTY_FOLDERS: string[] = [];

function WorkspaceLayoutSection() {
	const [mode, setMode] = useState(loadAgentLayoutMode);
	const selected = loadAgentState()?.groups.find(
		(group) => group.id === loadAgentState()?.selectedGroupId,
	);
	const [columns, setColumns] = useState(selected?.columns ?? 1);
	const updateMode = (next: "grid" | "rows") => {
		setMode(next);
		writeStoredValue("agent-layout-mode", next);
		dispatchAgentShellChange({ source: "view", reason: "layout-mode" });
	};
	const updateColumns = async (next: number) => {
		setColumns(next);
		await mutateCanonicalAgentState(
			(state) => ({
				...state,
				groups: state.groups.map((group) =>
					group.id === state.selectedGroupId
						? { ...group, columns: next }
						: group,
				),
			}),
			"grid-size",
		);
	};
	return (
		<div id="workspace-layout" {...stylex.props(styles.section)}>
			<h4 {...stylex.props(styles.sectionHeading)}>Workspace layout</h4>
			<p {...stylex.props(styles.sectionDescription)}>
				Choose how chat panes are arranged in the selected workspace.
			</p>
			<div {...stylex.props(styles.layoutControls)}>
				<div {...stylex.props(styles.layoutControlGroup)}>
					<span {...stylex.props(styles.layoutControlLabel)}>Flow</span>
					<div {...stylex.props(styles.colorSourceOptions)}>
						{(["grid", "rows"] as const).map((value) => (
							<button
								key={value}
								type="button"
								onClick={() => updateMode(value)}
								{...stylex.props(
									styles.colorSourceButton,
									mode === value && styles.colorSourceButtonSelected,
								)}
							>
								{value === "grid" ? "Grid" : "Rows"}
							</button>
						))}
					</div>
				</div>
				<div {...stylex.props(styles.layoutControlGroup)}>
					<span {...stylex.props(styles.layoutControlLabel)}>Columns</span>
					<div {...stylex.props(styles.colorSourceOptions)}>
						{[1, 2, 3, 4].map((value) => (
							<button
								key={value}
								type="button"
								onClick={() => {
									updateMode("grid");
									void updateColumns(value);
								}}
								{...stylex.props(
									styles.colorSourceButton,
									mode === "grid" &&
										columns === value &&
										styles.colorSourceButtonSelected,
								)}
							>
								{value}
							</button>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

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
				onInput={(e) => onChange(e.currentTarget.value as HexColor)}
				{...stylex.props(styles.colorInput)}
			/>
			<span {...stylex.props(styles.mutedText)}>{label}</span>
			<span {...stylex.props(styles.colorValue)}>{value}</span>
		</label>
	);
}

function GlobalAgentInstructionsSection() {
	const [instructions, setInstructions] = useState("");
	const [savedInstructions, setSavedInstructions] = useState("");
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		void fetchJson<EffectiveAgentContext>(
			"/api/agent-context?paneId=global-settings",
		)
			.then((context) => {
				setInstructions(context.global.instructions);
				setSavedInstructions(context.global.instructions);
				setError("");
			})
			.catch((cause) => {
				setError(
					cause instanceof Error
						? cause.message
						: "Unable to load agent instructions",
				);
			})
			.finally(() => {
				setIsLoading(false);
			});
	}, []);

	const handleSave = async () => {
		setIsSaving(true);
		setError("");
		try {
			await postJson(
				"/api/agent-context",
				{
					scope: "global",
					instructions,
					mode: "inherit",
					paneId: "global-settings",
				},
				{ method: "PUT" },
			);
			setSavedInstructions(instructions);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Unable to save agent instructions",
			);
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<div id="agent-instructions" {...stylex.props(styles.section)}>
			<div {...stylex.props(styles.agentInstructionsHeading)}>
				<div>
					<h4 {...stylex.props(styles.sectionHeading)}>
						Global agent instructions
					</h4>
					<p {...stylex.props(styles.sectionDescription)}>
						Your default AGENTS.md. Every new chat inherits these instructions.
					</p>
				</div>
			</div>
			<textarea
				value={instructions}
				onInput={(event) => {
					setInstructions(event.currentTarget.value);
				}}
				disabled={isLoading}
				placeholder="How should agents work with you?"
				{...stylex.props(styles.agentInstructionsEditor)}
			/>
			<div {...stylex.props(styles.agentInstructionsActions)}>
				<Button
					variant="secondary"
					size="sm"
					liquid={false}
					disabled={isLoading || isSaving || instructions === savedInstructions}
					onClick={() => void handleSave()}
				>
					{isSaving ? "Saving…" : "Save"}
				</Button>
			</div>
			{error ? <p {...stylex.props(styles.backgroundError)}>{error}</p> : null}
		</div>
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
				selected && styles.themeOrbSelected,
			)}
		>
			<div
				{...stylex.props(
					styles.themeOrb,
					dashed && styles.themeOrbDashed,
					selected && styles.themeOrbSelectedRing,
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
					selected && styles.themeOrbLabelSelected,
				)}
			>
				{theme.name}
			</span>
		</button>
	);
}

function BackgroundScenePicker() {
	const [background, setBackground] = useState<AppBackgroundSettings>(
		loadAppBackgroundSettings,
	);
	const [uploading, setUploading] = useState(false);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	useEffect(
		() =>
			listenWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, (event) => {
				const key = (event as CustomEvent<{ key?: string }>).detail?.key;
				if (key === APP_BACKGROUND_STORAGE_KEY) {
					setBackground(loadAppBackgroundSettings());
				}
			}),
		[],
	);

	const updateBackground = useCallback(
		(patch: Partial<AppBackgroundSettings>) => {
			setBackground((current) => {
				const next = { ...current, ...patch };
				saveAppBackgroundSettings(next);
				return next;
			});
		},
		[],
	);
	const selectBackgroundMode = useCallback(
		(mode: AppBackgroundSettings["mode"]) => {
			saveAppThemeId("default");
			applyAppTheme("default");
			updateBackground({ mode, autoTheme: false });
		},
		[updateBackground],
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
						(await response.text()) || "Could not import that image",
					);
				}
				const payload = (await response.json()) as { revision?: number };
				updateBackground({
					id: "custom",
					autoTheme: false,
					customRevision: payload.revision ?? Date.now(),
				});
			} catch (error) {
				setUploadError(
					error instanceof Error
						? error.message
						: "Could not import that image",
				);
			} finally {
				setUploading(false);
				if (fileInputRef.current) fileInputRef.current.value = "";
			}
		},
		[updateBackground],
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
	];

	return (
		<div {...stylex.props(styles.section)}>
			<div {...stylex.props(styles.backgroundHeadingRow)}>
				<div>
					<h4 {...stylex.props(styles.sectionHeading)}>Background</h4>
					<p {...stylex.props(styles.sectionDescription)}>
						Choose a clean solid background, a scene, or desktop glass.
					</p>
				</div>
				{background.mode === "scene" ? (
					<Button
						liquid={false}
						type="button"
						size="sm"
						variant="secondary"
						onClick={() => fileInputRef.current?.click()}
						disabled={uploading}
					>
						<IconFolder size={iconSize.sm} />
						{uploading ? "Importing…" : "Choose image"}
					</Button>
				) : null}
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
			<div {...stylex.props(styles.colorSourceOptions)}>
				{(["solid", "scene", "glass"] as const).map((mode) => (
					<button
						key={mode}
						type="button"
						onClick={() => selectBackgroundMode(mode)}
						{...stylex.props(
							styles.colorSourceButton,
							background.mode === mode && styles.colorSourceButtonSelected,
						)}
					>
						{mode === "solid"
							? "Solid black"
							: mode === "scene"
								? "Scene"
								: "Glass"}
					</button>
				))}
			</div>
			{background.mode === "scene" ? (
				<>
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
													autoTheme: false,
												})
									}
									{...stylex.props(
										styles.backgroundCard,
										selected && styles.backgroundCardSelected,
									)}
								>
									<span
										{...stylex.props(styles.backgroundPreview)}
										style={{
											backgroundImage: scene.path
												? `linear-gradient(rgba(2,3,8,.12), rgba(2,3,8,.32)), url("${resolveServerUrl(scene.path)}")`
												: "linear-gradient(135deg, #272938, #0a0b10)",
										}}
									/>
									<span {...stylex.props(styles.backgroundName)}>
										{scene.name}
									</span>
								</button>
							);
						})}
					</div>
					{uploadError ? (
						<p {...stylex.props(styles.backgroundError)}>{uploadError}</p>
					) : null}
					<div {...stylex.props(styles.backgroundControls)}>
						<label {...stylex.props(styles.backgroundControl)}>
							<span>Darkness</span>
							<input
								type="range"
								min="0"
								max="85"
								value={background.dim}
								{...stylex.props(styles.backgroundRange)}
								onInput={(event) =>
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
								onInput={(event) =>
									updateBackground({ blur: Number(event.currentTarget.value) })
								}
							/>
							<span {...stylex.props(styles.backgroundValue)}>
								{background.blur}px
							</span>
						</label>
					</div>
				</>
			) : null}
			{background.mode === "glass" ? (
				<div {...stylex.props(styles.backgroundControls)}>
					<label {...stylex.props(styles.backgroundControl)}>
						<span>Window blur</span>
						<input
							type="range"
							min="0"
							max="40"
							value={background.glassBlur}
							{...stylex.props(styles.backgroundRange)}
							onInput={(event) =>
								updateBackground({
									glassBlur: Number(event.currentTarget.value),
								})
							}
						/>
						<span {...stylex.props(styles.backgroundValue)}>
							{background.glassBlur}px
						</span>
					</label>
					<label {...stylex.props(styles.backgroundControl)}>
						<span>Window transparency</span>
						<input
							type="range"
							min="0"
							max="92"
							value={100 - background.glassOpacity}
							{...stylex.props(styles.backgroundRange)}
							onInput={(event) =>
								updateBackground({
									glassOpacity: 100 - Number(event.currentTarget.value),
								})
							}
						/>
						<span {...stylex.props(styles.backgroundValue)}>
							{100 - background.glassOpacity}%
						</span>
					</label>
				</div>
			) : null}
		</div>
	);
}

function SearchFoldersSection() {
	const fetchSearchFolders = useCallback(async () => {
		const data = await fetchJsonOr<{ folders: string[] }>(
			"/api/config/search-folders",
			{ folders: [] },
		);
		return data.folders;
	}, []);
	const { data: loadedFolders, setData: setFolders } = useQueryResource<
		string[] | null
	>(fetchSearchFolders, null, {
		queryKey: ["agent", "search-folders"],
		isEqual: areLoadedFoldersEqual,
	});
	const folders = useMemo(
		() => loadedFolders ?? EMPTY_FOLDERS,
		[loadedFolders],
	);
	const [newFolder, setNewFolder] = useState("");
	const inputRef = useRef<HTMLInputElement | null>(null);

	const saveFolders = useCallback(
		async (next: string[]) => {
			setFolders(next);
			await fetch("/api/config/search-folders", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ folders: next }),
			});
		},
		[setFolders],
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
		[folders, saveFolders],
	);

	const browseFolder = useCallback(async () => {
		try {
			const { folder } = await fetchJsonOr<{ folder: string | null }>(
				"/api/config/pick-folder",
				{ folder: null },
				{ method: "POST" },
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
							<IconX size={iconSize.xs} />
						</IconButton>
					</div>
				))}
			</div>
			<div {...stylex.props(styles.folderInputRow)}>
				<input
					ref={inputRef}
					type="text"
					value={newFolder}
					onInput={setInputValue.bind(null, setNewFolder)}
					onKeyDown={(e) => {
						if (e.key === "Enter") addFolder();
					}}
					placeholder="~/path/to/folder"
					{...stylex.props(styles.folderInput)}
				/>
				<Button
					liquid={false}
					type="button"
					onClick={addFolder}
					disabled={!newFolder.trim()}
					variant="secondary"
					size="sm"
					className={stylex.props(styles.folderActionButton).className}
				>
					<IconPlus size={iconSize.sm} />
					Add
				</Button>
				<Button
					liquid={false}
					type="button"
					onClick={browseFolder}
					variant="secondary"
					size="sm"
					className={
						stylex.props(styles.browseButton, styles.folderActionButton)
							.className
					}
				>
					<IconFolder size={iconSize.sm} />
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
	const [backgroundMode, setBackgroundMode] = useState(
		() => loadAppBackgroundSettings().mode,
	);
	const [agentThemeId, setAgentThemeId] = useState<ThemeId>(() => {
		const state = loadAgentState();
		return (
			themeId ?? state?.themeId ?? mapAppThemeToAgentTheme(loadAppThemeId())
		);
	});
	const [syntaxTheme, setSyntaxTheme] = useSyntaxHighlightTheme();
	const [appFontId, setAppFontId] = useState<AppFontId>(loadAppFontId);
	const { data: appInfo } = useAppInfo();

	const handleThemeChange = useCallback(
		(id: AppThemeId) => {
			setAppThemeId(id);
			saveAppThemeId(id);
			const background = loadAppBackgroundSettings();
			saveAppBackgroundSettings({
				...background,
				mode: "solid",
				id: "none",
				autoTheme: false,
			});
			setBackgroundMode("solid");
			applyAppTheme(id);
			const termThemeId = mapAppThemeToAgentTheme(id);
			setAgentThemeId(termThemeId);
			onThemeChange?.(termThemeId);
			void mutateCanonicalAgentState(
				(state) => ({ ...state, themeId: termThemeId }),
				"theme-change",
			);
		},
		[onThemeChange],
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
						"custom-theme",
					);
				}
				return next;
			});
		},
		[agentThemeId, onThemeChange],
	);
	useEffect(() => {
		if (themeId) setAgentThemeId(themeId);
	}, [themeId]);
	useEffect(
		() =>
			listenWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, (event) => {
				const key = (event as CustomEvent<{ key?: string }>).detail?.key;
				if (key === APP_BACKGROUND_STORAGE_KEY) {
					setBackgroundMode(loadAppBackgroundSettings().mode);
				}
				if (key === APP_THEME_STORAGE_KEY) {
					const nextAppThemeId = loadAppThemeId();
					const nextAgentThemeId = mapAppThemeToAgentTheme(nextAppThemeId);
					setAppThemeId(nextAppThemeId);
					setAgentThemeId(nextAgentThemeId);
				}
			}),
		[],
	);
	const isCustom = appThemeId === "custom";

	return (
		<div
			{...stylex.props(styles.panelBody, embedded && styles.panelBodyEmbedded)}
		>
			<GlobalAgentInstructionsSection />
			<div {...stylex.props(styles.divider)} />
			<WorkspaceLayoutSection />
			<div {...stylex.props(styles.divider)} />
			<div id="appearance" {...stylex.props(styles.section)}>
				<h4 {...stylex.props(styles.sectionHeading)}>Theme</h4>
				<p {...stylex.props(styles.sectionDescription)}>
					Choose a theme with a clean black background. Themes and background
					worlds are mutually exclusive.
				</p>
				<div {...stylex.props(styles.themeGrid)}>
					{VISIBLE_APP_THEMES.map((t) => (
						<ThemeOrb
							key={t.id}
							theme={t}
							selected={backgroundMode === "solid" && appThemeId === t.id}
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
							selected={backgroundMode === "solid" && isCustom}
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
			<div {...stylex.props(styles.section)}>
				<h4 {...stylex.props(styles.sectionHeading)}>Interface font</h4>
				<p {...stylex.props(styles.sectionDescription)}>
					Change the typeface throughout Inferay without changing text sizes or
					spacing.
				</p>
				<DropdownButton
					liquid={false}
					value={appFontId}
					options={[...APP_FONTS]}
					onChange={(id) => {
						const next = id as AppFontId;
						setAppFontId(next);
						saveAppFontId(next);
						applyAppFont(next);
					}}
					placeholder="Interface font"
					fullWidth
					buttonClassName={stylex.props(styles.syntaxThemeButton).className}
					labelClassName={stylex.props(styles.syntaxThemeLabel).className}
				/>
			</div>
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
					liquid={false}
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
		inset: controlSize._0,
		zIndex: layer.panelOverlay,
		display: "flex",
		alignItems: "flex-start",
		justifyContent: "flex-end",
		backgroundColor: color.backgroundOverlay,
		padding: controlSize._4,
	},
	backdrop: {
		position: "absolute",
		inset: controlSize._0,
		borderWidth: 0,
		padding: controlSize._0,
		backgroundColor: color.transparent,
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
		paddingBlock: controlSize._0,
		paddingInline: controlSize._0,
		paddingBottom: controlSize._0,
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
		paddingInline: controlSize._0,
		scrollSnapAlign: "start",
		transitionProperty: "opacity, color",
		transitionDuration: motion.durationBase,
		backgroundColor: color.transparent,
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
		borderRadius: radius.pill,
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
		inset: controlSize._0,
		borderRadius: radius.pill,
		transitionProperty: "transform",
		transitionDuration: motion.durationBase,
	},
	themeOrbGlow: {
		position: "absolute",
		borderRadius: radius.pill,
	},
	themeOrbHighlight: {
		position: "absolute",
		borderRadius: radius.pill,
	},
	themeOrbLabel: {
		color: color.textMuted,
		fontSize: font.size_1,
		lineHeight: 1,
	},
	themeOrbLabelSelected: {
		color: color.textMain,
		fontWeight: font.weight_6,
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
		backgroundColor: color.surfaceWhite025,
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
		transitionDuration: motion.durationBase,
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
		borderRadius: radius.px5,
		display: "block",
		height: controlSize._16,
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
		margin: controlSize._0,
	},
	backgroundControls: {
		backgroundColor: color.surfaceWhite025,
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
		marginTop: controlSize._0_5,
	},
	colorSourceOptions: {
		backgroundColor: color.surfaceInset,
		borderColor: color.border,
		borderRadius: controlSize._1_5,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		flexShrink: 0,
		gap: controlSize._0_5,
		padding: controlSize._0_5,
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
		margin: controlSize._0,
		width: "100%",
	},
	backgroundValue: {
		color: color.textSoft,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		textAlign: "right",
	},
	divider: {
		height: controlSize._0_25,
		backgroundColor: color.border,
	},
	section: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
	},
	sectionHeading: {
		margin: controlSize._0,
		color: color.textMain,
		fontSize: font.size_3,
		fontWeight: font.weight_6,
	},
	customHeading: {
		marginBottom: controlSize._3,
	},
	sectionDescription: {
		margin: controlSize._0,
		color: color.textMuted,
		fontSize: font.size_2,
		lineHeight: 1.5,
	},
	layoutControls: {
		display: "flex",
		flexWrap: "wrap",
		gap: controlSize._4,
	},
	layoutControlGroup: {
		alignItems: "center",
		display: "flex",
		gap: controlSize._2,
	},
	layoutControlLabel: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
	},
	agentInstructionsHeading: {
		alignItems: "flex-start",
		display: "flex",
		gap: controlSize._3,
		justifyContent: "space-between",
	},
	agentInstructionsEditor: {
		backgroundColor: color.surfaceInset,
		borderColor: color.border,
		borderRadius: controlSize._2,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		fontFamily: "var(--font-mono)",
		fontSize: font.size_2,
		lineHeight: 1.5,
		minHeight: 220,
		outline: "none",
		padding: controlSize._2_5,
		resize: "vertical",
	},
	agentInstructionsActions: {
		display: "flex",
		justifyContent: "flex-end",
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
		borderRadius: radius.sm,
		backgroundColor: color.transparent,
		padding: controlSize._0,
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
		borderRadius: radius.md,
		fontFamily:
			"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
		fontSize: font.size_2_75,
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
		borderRadius: radius.sm,
		paddingBlock: "0.125rem",
		paddingInline: "0.375rem",
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
	},
	folderPath: {
		minWidth: controlSize._0,
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
		minWidth: controlSize._0,
		flex: 1,
		height: controlSize._7,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: {
			default: color.border,
			":focus": color.borderStrong,
		},
		borderRadius: radius.md,
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
