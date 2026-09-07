import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal, onSettled } from "solid-js";
import type { AppFontId } from "../../../../../build/presentation/contracts/AppFontId.ts";
import type { AppThemeId } from "../../../../../build/presentation/contracts/AppThemeId.ts";
import {
	APP_FONTS,
	APP_THEMES,
	applyAppFont,
	applyAppTheme,
	loadAppBackgroundSettings,
	loadAppFontId,
	loadAppThemeId,
	saveAppBackgroundSettings,
	saveAppFontId,
	saveAppThemeId,
} from "../../../../app/hooks/useAppAppearance.tsx";
import { useAppInfo } from "../../../../app/hooks/useAppInfo.tsx";
import {
	SYNTAX_HIGHLIGHT_THEMES,
	type SyntaxHighlightTheme,
	useSyntaxHighlightTheme,
} from "../../../../shared/hooks/useSyntaxHighlight.tsx";
import { listenWindowEvent } from "../../../../shared/lib/dom.tsx";
import {
	APP_BACKGROUND_STORAGE_KEY,
	APP_THEME_STORAGE_KEY,
	CLIENT_STORAGE_CHANGED_EVENT,
} from "../../../../shared/lib/native.tsx";
import { DropdownButton } from "../../../../shared/ui/DropdownButton/index.tsx";
import { mutateAgentWorkspaceState } from "../../../workspace/hooks/useWorkspaceState.tsx";
import { BackgroundScenePicker } from "./BackgroundScenePicker.tsx";
import { GlobalAgentInstructionsSection } from "./GlobalAgentInstructionsSection.tsx";
import { SearchFoldersSection } from "./SearchFoldersSection.tsx";
import { styles } from "./styles.ts";
import { ThemeOrb } from "./ThemeOrb.tsx";
import { WorkspaceLayoutSection } from "./WorkspaceLayoutSection.tsx";

interface SettingsContentProps {
	themeId?: AppThemeId;
	onThemeChange?: (id: AppThemeId) => void;
	showVersion?: boolean;
	embedded?: boolean;
	section?: "all" | "agents" | "appearance" | "workspace";
}
export const SettingsContent = function SettingsContent(
	_props: SettingsContentProps,
) {
	const [appThemeId, setAppThemeId] = createSignal<AppThemeId>(loadAppThemeId);
	const [backgroundMode, setBackgroundMode] = createSignal(
		(() => loadAppBackgroundSettings().mode)(),
	);
	const [syntaxTheme, setSyntaxTheme] = useSyntaxHighlightTheme();
	const [appFontId, setAppFontId] = createSignal<AppFontId>(loadAppFontId);
	const _source = useAppInfo();
	const handleThemeChange = (id: AppThemeId) => {
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
		_props.onThemeChange?.(termThemeId);
		void mutateAgentWorkspaceState({
			type: "setTheme",
			themeId: termThemeId,
		});
	};
	onSettled(() => {
		return listenWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, (event) => {
			const key = (
				event as CustomEvent<{
					key?: string;
				}>
			).detail?.key;
			if (key === APP_BACKGROUND_STORAGE_KEY) {
				setBackgroundMode(loadAppBackgroundSettings().mode);
			}
			if (key === APP_THEME_STORAGE_KEY) {
				const nextAppThemeId = loadAppThemeId();
				setAppThemeId(nextAppThemeId);
			}
		});
	});
	const showAgents = createMemo(
		() =>
			(_props.section === undefined ? "all" : _props.section) === "all" ||
			(_props.section === undefined ? "all" : _props.section) === "agents",
	);
	const showAppearance = createMemo(
		() =>
			(_props.section === undefined ? "all" : _props.section) === "all" ||
			(_props.section === undefined ? "all" : _props.section) === "appearance",
	);
	const showWorkspace = createMemo(
		() =>
			(_props.section === undefined ? "all" : _props.section) === "all" ||
			(_props.section === undefined ? "all" : _props.section) === "workspace",
	);
	return (
		<div
			{...stylex.attrs(
				styles.panelBody,
				(_props.embedded === undefined ? false : _props.embedded) &&
					styles.panelBodyEmbedded,
			)}
		>
			{showAgents() ? (
				<GlobalAgentInstructionsSection
					contained={_props.embedded === undefined ? false : _props.embedded}
				/>
			) : null}
			{showAgents() &&
			showWorkspace() &&
			!(_props.embedded === undefined ? false : _props.embedded) ? (
				<div {...stylex.attrs(styles.divider)} />
			) : null}
			{showWorkspace() ? (
				<>
					<WorkspaceLayoutSection
						contained={_props.embedded === undefined ? false : _props.embedded}
					/>
					{!(_props.embedded === undefined ? false : _props.embedded) ? (
						<div {...stylex.attrs(styles.divider)} />
					) : null}
					<SearchFoldersSection
						contained={_props.embedded === undefined ? false : _props.embedded}
					/>
				</>
			) : null}
			{showWorkspace() &&
			showAppearance() &&
			!(_props.embedded === undefined ? false : _props.embedded) ? (
				<div {...stylex.attrs(styles.divider)} />
			) : null}
			{showAppearance() ? (
				<>
					<div
						id="appearance"
						{...stylex.attrs(
							styles.section,
							(_props.embedded === undefined ? false : _props.embedded) &&
								styles.sectionContained,
						)}
					>
						<h4 {...stylex.attrs(styles.sectionHeading)}>Theme</h4>
						<p {...stylex.attrs(styles.sectionDescription)}>
							A subtle tint for Inferay's solid background.
						</p>
						<div {...stylex.attrs(styles.themeGrid)}>
							{APP_THEMES.map((t) => (
								<ThemeOrb
									theme={t}
									selected={
										backgroundMode() === "solid" && appThemeId() === t.id
									}
									onClick={() => handleThemeChange(t.id)}
								/>
							))}
						</div>
					</div>
					{!(_props.embedded === undefined ? false : _props.embedded) ? (
						<div {...stylex.attrs(styles.divider)} />
					) : null}
					<div
						{...stylex.attrs(
							styles.section,
							(_props.embedded === undefined ? false : _props.embedded) &&
								styles.sectionContained,
						)}
					>
						<h4 {...stylex.attrs(styles.sectionHeading)}>Interface font</h4>
						<p {...stylex.attrs(styles.sectionDescription)}>
							Use system interface text with Menlo for code and diffs.
						</p>
						<DropdownButton
							liquid={false}
							value={appFontId()}
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
							buttonClassName={stylex.attrs(styles.syntaxThemeButton).class}
						/>
					</div>
					{!(_props.embedded === undefined ? false : _props.embedded) ? (
						<div {...stylex.attrs(styles.divider)} />
					) : null}
					<BackgroundScenePicker
						contained={_props.embedded === undefined ? false : _props.embedded}
					/>
					{!(_props.embedded === undefined ? false : _props.embedded) ? (
						<div {...stylex.attrs(styles.divider)} />
					) : null}
					<div
						{...stylex.attrs(
							styles.section,
							(_props.embedded === undefined ? false : _props.embedded) &&
								styles.sectionContained,
						)}
					>
						<h4 {...stylex.attrs(styles.sectionHeading)}>Code appearance</h4>
						<p {...stylex.attrs(styles.sectionDescription)}>
							Syntax colors for full file and inline diffs.
						</p>
						<DropdownButton
							liquid={false}
							value={syntaxTheme()}
							options={SYNTAX_HIGHLIGHT_THEMES}
							onChange={(id) => setSyntaxTheme(id as SyntaxHighlightTheme)}
							placeholder="Syntax theme"
							fullWidth
							buttonClassName={stylex.attrs(styles.syntaxThemeButton).class}
							labelClassName={stylex.attrs(styles.syntaxThemeLabel).class}
						/>
					</div>
				</>
			) : null}
			{(_props.showVersion === undefined ? true : _props.showVersion) ? (
				<p {...stylex.attrs(styles.versionText)}>
					inferay {_source.data.version}
				</p>
			) : null}
		</div>
	);
};
