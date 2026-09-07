import * as stylex from "@stylexjs/stylex";
import type { AppThemeId } from "../../../../../build/presentation/contracts/AppThemeId.ts";
import { SettingsContent } from "./SettingsContent.tsx";
import { styles } from "./styles.ts";

interface SettingsProps {
	themeId: AppThemeId;
	onThemeChange: (id: AppThemeId) => void;
	onClose: () => void;
}
export const Settings = function Settings(_props: SettingsProps) {
	return (
		<div {...stylex.attrs(styles.overlay)}>
			<button
				type="button"
				aria-label="Close agent settings"
				{...stylex.attrs(styles.backdrop)}
				onClick={_props.onClose}
			/>
			<div {...stylex.attrs(styles.panel)}>
				<SettingsContent
					themeId={_props.themeId}
					onThemeChange={_props.onThemeChange}
				/>
			</div>
		</div>
	);
};
export { SettingsContent } from "./SettingsContent.tsx";
