import type { AppBackgroundSettings } from "@contracts";
import * as stylex from "@stylexjs/stylex";
import { SettingsRow } from "../../../../shared/ui/SettingsSurface/index.tsx";
import { styles } from "./styles.ts";
export function BackgroundSceneControls(_props: {
	background: AppBackgroundSettings;
	updateBackground: (patch: Partial<AppBackgroundSettings>) => void;
}) {
	return (
		<>
			<SettingsRow label="Darkness">
				<input
					type="range"
					min="0"
					max="85"
					aria-label="Darkness"
					value={_props.background.dim}
					{...stylex.attrs(styles.backgroundRange)}
					onInput={(event) =>
						_props.updateBackground({
							dim: Number(event.currentTarget.value),
						})
					}
				/>
				<span {...stylex.attrs(styles.backgroundValue)}>
					{_props.background.dim}%
				</span>
			</SettingsRow>
			<SettingsRow label="Image softness">
				<input
					type="range"
					min="0"
					max="20"
					aria-label="Image softness"
					value={_props.background.blur}
					{...stylex.attrs(styles.backgroundRange)}
					onInput={(event) =>
						_props.updateBackground({
							blur: Number(event.currentTarget.value),
						})
					}
				/>
				<span {...stylex.attrs(styles.backgroundValue)}>
					{_props.background.blur}px
				</span>
			</SettingsRow>
		</>
	);
}
