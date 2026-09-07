import * as stylex from "@octanejs/stylex";
import type { AppBackgroundSettings } from "../../../../../build/presentation/contracts/AppBackgroundSettings.ts";
import { styles } from "./styles.ts";

export function BackgroundSceneControls({
	background,
	updateBackground,
}: {
	background: AppBackgroundSettings;
	updateBackground: (patch: Partial<AppBackgroundSettings>) => void;
}) {
	return (
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
				<span {...stylex.props(styles.backgroundValue)}>{background.dim}%</span>
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
	);
}
