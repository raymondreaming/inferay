import * as stylex from "@octanejs/stylex";
import type { AppBackgroundId } from "../../../../../build/presentation/contracts/AppBackgroundId.ts";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

export function BackgroundSceneCard({
	scene,
	selected,
	onSelect,
}: {
	scene: { id: AppBackgroundId; name: string; path: string | null };
	selected: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			key={scene.id}
			type="button"
			onClick={onSelect}
			{...stylex.props(
				styles.backgroundCard,
				selected && styles.backgroundCardSelected,
			)}
		>
			<span
				{...stylex.props(styles.backgroundPreview)}
				style={inlineStyles.getBackgroundScenePickerBackgroundPreviewStyle(
					scene.path
						? `linear-gradient(rgba(2,3,8,.12), rgba(2,3,8,.32)), url("${scene.path}")`
						: "linear-gradient(135deg, #272938, #0a0b10)",
				)}
			/>
			<span {...stylex.props(styles.backgroundName)}>{scene.name}</span>
		</button>
	);
}
