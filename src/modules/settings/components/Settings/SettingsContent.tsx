import type { AppFontId, AppThemeId } from "@contracts";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, onSettled } from "solid-js";
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
import {
	SettingsRow,
	SettingsSection,
} from "../../../../shared/ui/SettingsSurface/index.tsx";
import { mutateAgentWorkspaceState } from "../../../workspace/hooks/useWorkspaceState.tsx";
import { BackgroundScenePicker } from "./BackgroundScenePicker.tsx";
import { GlobalAgentInstructionsSection } from "./GlobalAgentInstructionsSection.tsx";
import { SearchFoldersSection } from "./SearchFoldersSection.tsx";
import { styles } from "./styles.ts";
import { ThemeOrb } from "./ThemeOrb.tsx";

interface SettingsContentProps {
	onThemeChange?: (id: AppThemeId) => void;
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
	const section = createMemo(() =>
		_props.section === undefined ? "all" : _props.section,
	);
	const showAgents = createMemo(
		() => section() === "all" || section() === "agents",
	);
	const showAppearance = createMemo(
		() => section() === "all" || section() === "appearance",
	);
	const showWorkspace = createMemo(
		() => section() === "all" || section() === "workspace",
	);
	return (
		<>
			{showAgents() ? <GlobalAgentInstructionsSection /> : null}
			{showWorkspace() ? <SearchFoldersSection /> : null}
			{showAppearance() ? (
				<>
					<SettingsSection
						id="appearance"
						title="Theme"
						description="A subtle tint for Inferay's solid background."
					>
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
					</SettingsSection>
					<BackgroundScenePicker />
					<SettingsSection
						id="typography"
						title="Text and code"
						description="How Inferay renders interface text, diffs, and source."
					>
						<SettingsRow
							label="Interface font"
							description="System interface text with Menlo for code and diffs."
						>
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
								buttonClassName={stylex.attrs(styles.control).class}
								labelClassName={stylex.attrs(styles.controlLabel).class}
							/>
						</SettingsRow>
						<SettingsRow
							label="Code theme"
							description="Syntax colors for full files and inline diffs."
						>
							<DropdownButton
								liquid={false}
								value={syntaxTheme()}
								options={SYNTAX_HIGHLIGHT_THEMES}
								onChange={(id) => setSyntaxTheme(id as SyntaxHighlightTheme)}
								placeholder="Syntax theme"
								buttonClassName={stylex.attrs(styles.control).class}
								labelClassName={stylex.attrs(styles.controlLabel).class}
							/>
						</SettingsRow>
					</SettingsSection>
				</>
			) : null}
		</>
	);
};
