import {
	APP_FONTS,
	applyAppFont,
	loadAppFontId,
	saveAppFontId,
} from "@app/hooks/useAppAppearance.tsx";
import type { AppFontId, AppThemeId } from "@contracts";
import {
	SYNTAX_HIGHLIGHT_THEMES,
	type SyntaxHighlightTheme,
	useSyntaxHighlightTheme,
} from "@shared/hooks/useSyntaxHighlight.tsx";
import { DropdownButton } from "@shared/ui/DropdownButton/index.tsx";
import {
	SettingsRow,
	SettingsSection,
} from "@shared/ui/SettingsSurface/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal } from "solid-js";
import { BackgroundScenePicker } from "./BackgroundScenePicker.tsx";
import { GlobalAgentInstructionsSection } from "./GlobalAgentInstructionsSection.tsx";
import { SearchFoldersSection } from "./SearchFoldersSection.tsx";
import { styles } from "./styles.ts";

export const SettingsContent = function SettingsContent(props: {
	onThemeChange?: (id: AppThemeId) => void;
	section?: "all" | "agents" | "appearance" | "workspace";
}) {
	const [syntaxTheme, setSyntaxTheme] = useSyntaxHighlightTheme();
	const [appFontId, setAppFontId] = createSignal<AppFontId>(loadAppFontId);
	const section = createMemo(() =>
		props.section === undefined ? "all" : props.section,
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
							/>
						</SettingsRow>
						<SettingsRow
							label="Code theme"
							description="Syntax colors for full files and inline diffs."
						>
							<DropdownButton
								value={syntaxTheme()}
								options={SYNTAX_HIGHLIGHT_THEMES}
								onChange={(id) => setSyntaxTheme(id as SyntaxHighlightTheme)}
								placeholder="Syntax theme"
								buttonClassName={stylex.attrs(styles.control).class}
							/>
						</SettingsRow>
					</SettingsSection>
				</>
			) : null}
		</>
	);
};
