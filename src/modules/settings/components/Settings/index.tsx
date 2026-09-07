import * as stylex from "@octanejs/stylex";
import { memo } from "octane";
import type { AppThemeId } from "../../../../../build/presentation/contracts/AppThemeId.ts";
import { SettingsContent } from "./SettingsContent.tsx";
import { styles } from "./styles.ts";

interface SettingsProps {
	themeId: AppThemeId;
	onThemeChange: (id: AppThemeId) => void;
	onClose: () => void;
}

export const Settings = memo(function Settings({
	themeId,
	onThemeChange,
	onClose,
}: SettingsProps) {
	return (
		<div {...stylex.props(styles.overlay)}>
			<button
				type="button"
				aria-label="Close agent settings"
				{...stylex.props(styles.backdrop)}
				onClick={onClose}
			/>
			<div {...stylex.props(styles.panel)}>
				<SettingsContent themeId={themeId} onThemeChange={onThemeChange} />
			</div>
		</div>
	);
});

export { SettingsContent } from "./SettingsContent.tsx";
