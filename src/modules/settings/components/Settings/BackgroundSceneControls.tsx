import * as stylex from "@stylexjs/stylex";
import type { AppBackgroundSettings } from "../../../../../build/presentation/contracts/AppBackgroundSettings.ts";
import { styles } from "./styles.ts";
export function BackgroundSceneControls(_props: {
	background: AppBackgroundSettings;
	updateBackground: (patch: Partial<AppBackgroundSettings>) => void;
}) {
	return (
		<div {...stylex.attrs(styles.backgroundControls)}>
			<label {...stylex.attrs(styles.backgroundControl)}>
				<span>Darkness</span>
				<input
					type="range"
					min="0"
					max="85"
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
			</label>
			<label {...stylex.attrs(styles.backgroundControl)}>
				<span>Image softness</span>
				<input
					type="range"
					min="0"
					max="20"
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
			</label>
		</div>
	);
}
