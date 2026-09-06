import * as stylex from "@octanejs/stylex";
import { memo, useCallback, useEffect, useState } from "octane";
import {
	APP_BACKGROUND_STORAGE_KEY,
	APP_THEME_STORAGE_KEY,
	CLIENT_STORAGE_CHANGED_EVENT,
} from "../../../../adapters/storage/stored-values.ts";
import {
	APP_FONTS,
	APP_THEMES,
	type AppFontId,
	type AppThemeId,
	applyAppFont,
	applyAppTheme,
	loadAppBackgroundSettings,
	loadAppFontId,
	loadAppThemeId,
	saveAppBackgroundSettings,
	saveAppFontId,
	saveAppThemeId,
	useAppInfo,
} from "../../../../app/model/appearance.ts";
import {
	SYNTAX_HIGHLIGHT_THEMES,
	type SyntaxHighlightTheme,
	useSyntaxHighlightTheme,
} from "../../../../shared/hooks/useSyntaxHighlight.tsx";
import { listenWindowEvent } from "../../../../shared/lib/data.ts";
import { DropdownButton } from "../../../../shared/ui/DropdownButton/index.tsx";
import {
	mutateAgentWorkspaceState,
	type ThemeId,
} from "../../../workspace/model/workspace-model.ts";
import { BackgroundScenePicker } from "./BackgroundScenePicker.tsx";
import { GlobalAgentInstructionsSection } from "./GlobalAgentInstructionsSection.tsx";
import { SearchFoldersSection } from "./SearchFoldersSection.tsx";
import { styles } from "./styles.ts";
import { ThemeOrb } from "./ThemeOrb.tsx";
import { WorkspaceLayoutSection } from "./WorkspaceLayoutSection.tsx";

interface SettingsContentProps {
	themeId?: ThemeId;
	onThemeChange?: (id: ThemeId) => void;
	showVersion?: boolean;
	embedded?: boolean;
	section?: "all" | "agents" | "appearance" | "workspace";
}

export const SettingsContent = memo(function SettingsContent({
	onThemeChange,
	showVersion = true,
	embedded = false,
	section = "all",
}: SettingsContentProps) {
	const [appThemeId, setAppThemeId] = useState<AppThemeId>(loadAppThemeId);
	const [backgroundMode, setBackgroundMode] = useState(
		() => loadAppBackgroundSettings().mode,
	);
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
			const termThemeId = id;
			onThemeChange?.(termThemeId);
			void mutateAgentWorkspaceState({
				type: "setTheme",
				themeId: termThemeId,
			});
		},
		[onThemeChange],
	);

	useEffect(
		() =>
			listenWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, (event) => {
				const key = (event as CustomEvent<{ key?: string }>).detail?.key;
				if (key === APP_BACKGROUND_STORAGE_KEY) {
					setBackgroundMode(loadAppBackgroundSettings().mode);
				}
				if (key === APP_THEME_STORAGE_KEY) {
					const nextAppThemeId = loadAppThemeId();
					setAppThemeId(nextAppThemeId);
				}
			}),
		[],
	);
	const showAgents = section === "all" || section === "agents";
	const showAppearance = section === "all" || section === "appearance";
	const showWorkspace = section === "all" || section === "workspace";

	return (
		<div
			{...stylex.props(styles.panelBody, embedded && styles.panelBodyEmbedded)}
		>
			{showAgents ? (
				<GlobalAgentInstructionsSection contained={embedded} />
			) : null}
			{showAgents && showWorkspace && !embedded ? (
				<div {...stylex.props(styles.divider)} />
			) : null}
			{showWorkspace ? (
				<>
					<WorkspaceLayoutSection contained={embedded} />
					{!embedded ? <div {...stylex.props(styles.divider)} /> : null}
					<SearchFoldersSection contained={embedded} />
				</>
			) : null}
			{showWorkspace && showAppearance && !embedded ? (
				<div {...stylex.props(styles.divider)} />
			) : null}
			{showAppearance ? (
				<>
					<div
						id="appearance"
						{...stylex.props(
							styles.section,
							embedded && styles.sectionContained,
						)}
					>
						<h4 {...stylex.props(styles.sectionHeading)}>Theme</h4>
						<p {...stylex.props(styles.sectionDescription)}>
							A subtle tint for Inferay's solid background.
						</p>
						<div {...stylex.props(styles.themeGrid)}>
							{APP_THEMES.map((t) => (
								<ThemeOrb
									key={t.id}
									theme={t}
									selected={backgroundMode === "solid" && appThemeId === t.id}
									onClick={() => handleThemeChange(t.id)}
								/>
							))}
						</div>
					</div>
					{!embedded ? <div {...stylex.props(styles.divider)} /> : null}
					<div
						{...stylex.props(
							styles.section,
							embedded && styles.sectionContained,
						)}
					>
						<h4 {...stylex.props(styles.sectionHeading)}>Interface font</h4>
						<p {...stylex.props(styles.sectionDescription)}>
							Choose the typeface used throughout Inferay.
						</p>
						<DropdownButton
							liquid={false}
							value={appFontId}
							options={APP_FONTS.map((option) => ({
								id: option.id,
								label: option.label,
							}))}
							onChange={(id) => {
								const next = id as AppFontId;
								setAppFontId(next);
								saveAppFontId(next);
								applyAppFont(next);
							}}
							fullWidth
							buttonClassName={stylex.props(styles.syntaxThemeButton).className}
						/>
					</div>
					{!embedded ? <div {...stylex.props(styles.divider)} /> : null}
					<BackgroundScenePicker contained={embedded} />
					{!embedded ? <div {...stylex.props(styles.divider)} /> : null}
					<div
						{...stylex.props(
							styles.section,
							embedded && styles.sectionContained,
						)}
					>
						<h4 {...stylex.props(styles.sectionHeading)}>Code appearance</h4>
						<p {...stylex.props(styles.sectionDescription)}>
							Syntax colors for full file and inline diffs.
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
				</>
			) : null}
			{showVersion ? (
				<p {...stylex.props(styles.versionText)}>inferay {appInfo.version}</p>
			) : null}
		</div>
	);
});
