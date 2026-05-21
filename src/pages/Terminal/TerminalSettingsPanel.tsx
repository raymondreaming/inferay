import * as stylex from "@stylexjs/stylex";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { DropdownButton } from "../../components/ui/DropdownButton.tsx";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { IconX } from "../../components/ui/Icons.tsx";
import {
	type CustomThemeColors,
	type HexColor,
	loadCustomTheme,
	loadTerminalState,
	saveCustomTheme,
	saveTerminalState,
	type ThemeId,
} from "../../features/terminal/terminal-utils.ts";
import { useAsyncResource } from "../../hooks/useAsyncResource.ts";
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
import { fetchJsonOr } from "../../lib/fetch-json.ts";
import { setInputValue } from "../../lib/react-events.ts";
import { color, controlSize, font } from "../../tokens.stylex.ts";

interface TerminalSettingsPanelProps {
	themeId: ThemeId;
	onThemeChange: (id: ThemeId) => void;
	onClose: () => void;
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
				{...stylex.props(styles.themeOrb, dashed && styles.themeOrbDashed)}
				style={{ backgroundColor: black }}
			>
				<div
					{...stylex.props(styles.themeOrbFill)}
					style={{
						background: `radial-gradient(circle at 35% 35%, ${darkGray} 0%, ${black} 60%, ${black} 100%)`,
						boxShadow: selected
							? `0 0 16px 2px ${accent}50, inset 0 0 8px ${accent}20`
							: `0 0 10px 1px ${accent}15`,
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
	const { data: loadedFolders, setData: setFolders } = useAsyncResource<
		string[] | null
	>(
		async () => {
			const data = await fetchJsonOr<{ folders: string[] }>(
				"/api/config/search-folders",
				{ folders: [] }
			);
			return data.folders;
		},
		null,
		[]
	);
	const folders = loadedFolders ?? [];
	const [newFolder, setNewFolder] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const saveFolders = useCallback(async (next: string[]) => {
		setFolders(next);
		await fetch("/api/config/search-folders", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ folders: next }),
		});
	}, []);

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
			<h4 {...stylex.props(styles.sectionHeading)}>SEARCH FOLDERS</h4>
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
			<Button
				type="button"
				onClick={browseFolder}
				variant="secondary"
				size="sm"
				className={stylex.props(styles.browseButton).className}
			>
				+ Browse Folder
			</Button>
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
				>
					Add
				</Button>
			</div>
		</div>
	);
}

export const TerminalSettingsPanel = memo(function TerminalSettingsPanel({
	themeId,
	onThemeChange,
	onClose,
}: TerminalSettingsPanelProps) {
	const [appThemeId, setAppThemeId] = useState<AppThemeId>(loadAppThemeId);
	const [syntaxTheme, setSyntaxTheme] = useSyntaxHighlightTheme();

	const handleThemeChange = useCallback(
		(id: AppThemeId) => {
			setAppThemeId(id);
			saveAppThemeId(id);
			applyAppTheme(id);
			const termThemeId = mapAppThemeToTerminalTheme(id);
			onThemeChange(termThemeId);
			const state = loadTerminalState();
			if (state) {
				saveTerminalState({ ...state, themeId: termThemeId });
				window.dispatchEvent(new Event("terminal-shell-change"));
			}
		},
		[onThemeChange]
	);

	const [custom, setCustom] = useState<CustomThemeColors>(loadCustomTheme);
	const updateCustom = useCallback(
		(patch: Partial<CustomThemeColors>) => {
			setCustom((prev) => {
				const next = { ...prev, ...patch };
				saveCustomTheme(next);
				if (themeId === "custom") {
					onThemeChange("custom");
					const state = loadTerminalState();
					if (state) {
						saveTerminalState({ ...state, themeId: "custom" });
						window.dispatchEvent(new Event("terminal-shell-change"));
					}
				}
				return next;
			});
		},
		[themeId, onThemeChange]
	);
	useEffect(() => {
		if (themeId === "custom") saveCustomTheme(custom);
	}, [custom, themeId]);
	const isCustom = appThemeId === "custom";

	return (
		<>
			<div
				role="presentation"
				{...stylex.props(styles.backdrop)}
				onClick={onClose}
			/>
			<div {...stylex.props(styles.panel)}>
				<div {...stylex.props(styles.panelHeader)}>
					<span {...stylex.props(styles.panelTitle)}>THEME</span>
					<IconButton
						type="button"
						onClick={onClose}
						variant="ghost"
						size="xs"
						title="Close"
					>
						<IconX size={10} />
					</IconButton>
				</div>
				<div {...stylex.props(styles.panelBody)}>
					<div>
						<div {...stylex.props(styles.themeGrid)}>
							{APP_THEMES.map((t) => (
								<ThemeOrb
									key={t.id}
									theme={t}
									selected={appThemeId === t.id}
									onClick={() => handleThemeChange(t.id)}
								/>
							))}
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
						</div>
					</div>
					{isCustom && (
						<>
							<div {...stylex.props(styles.divider)} />
							<div {...stylex.props(styles.section)}>
								<h4
									{...stylex.props(styles.sectionHeading, styles.customHeading)}
								>
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
									<span style={{ color: custom.cursor }}>$</span> terminal-gui
									start
									<br />
									<span style={{ opacity: 0.6 }}>Loading...</span>
									<br />
									<span style={{ color: custom.cursor }}>✓</span> Ready
								</div>
							</div>
						</>
					)}
					<div {...stylex.props(styles.divider)} />
					<div {...stylex.props(styles.section)}>
						<h4 {...stylex.props(styles.sectionHeading)}>DIFFS</h4>
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
				</div>
			</div>
		</>
	);
});

const styles = stylex.create({
	backdrop: {
		position: "fixed",
		inset: 0,
		zIndex: 50,
		backgroundColor: "rgba(0, 0, 0, 0.3)",
	},
	panel: {
		position: "fixed",
		right: controlSize._3,
		top: controlSize._8,
		zIndex: 51,
		width: "330px",
		maxHeight: "calc(100vh - 3rem)",
		overflowY: "auto",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: controlSize._3,
		backgroundColor: color.background,
		boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
	},
	panelHeader: {
		position: "sticky",
		top: 0,
		zIndex: 10,
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		backgroundColor: color.background,
		paddingBlock: "0.625rem",
		paddingInline: controlSize._4,
	},
	panelTitle: {
		color: color.textMuted,
		fontSize: font.size_2,
		fontWeight: 700,
		letterSpacing: "0.08em",
	},
	panelBody: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._5,
		paddingBlock: controlSize._4,
		paddingInline: controlSize._4,
		paddingBottom: controlSize._6,
	},
	themeGrid: {
		display: "grid",
		gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
		gap: "0.625rem",
	},
	themeOrbButton: {
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		gap: "0.375rem",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: "transparent",
		borderRadius: controlSize._3,
		padding: controlSize._2,
		transitionProperty: "background-color, border-color",
		transitionDuration: "150ms",
		backgroundColor: {
			default: "transparent",
			":hover": color.controlHover,
		},
	},
	themeOrbSelected: {
		borderColor: color.borderStrong,
		backgroundColor: "rgba(255, 255, 255, 0.05)",
	},
	themeOrb: {
		position: "relative",
		width: controlSize._12,
		height: controlSize._12,
		borderRadius: "999px",
	},
	themeOrbDashed: {
		borderWidth: 1,
		borderStyle: "dashed",
		borderColor: color.border,
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
	},
	sectionHeading: {
		marginBottom: controlSize._2,
		color: color.textSoft,
		fontSize: font.size_2,
		fontWeight: 600,
	},
	customHeading: {
		marginBottom: controlSize._3,
	},
	sectionDescription: {
		marginBottom: controlSize._2,
		color: color.textMuted,
		fontSize: font.size_1,
		lineHeight: 1.45,
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
		marginBottom: controlSize._2,
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
		width: "100%",
		marginBottom: "0.375rem",
		borderStyle: "dashed",
		fontSize: font.size_2,
	},
	folderInputRow: {
		display: "flex",
		gap: "0.375rem",
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
});
