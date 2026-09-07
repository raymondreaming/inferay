import * as stylex from "@stylexjs/stylex";
import type { AppBackgroundId } from "../../../../../build/presentation/contracts/AppBackgroundId.ts";
import { domStyle } from "../../../../shared/lib/dom.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
export function BackgroundSceneCard(_props: {
	scene: {
		id: AppBackgroundId;
		name: string;
		path: string | null;
	};
	selected: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			onClick={_props.onSelect}
			{...stylex.attrs(
				styles.backgroundCard,
				_props.selected && styles.backgroundCardSelected,
			)}
		>
			<span
				{...stylex.attrs(styles.backgroundPreview)}
				style={domStyle(
					inlineStyles.getBackgroundScenePickerBackgroundPreviewStyle(
						_props.scene.path
							? `linear-gradient(rgba(2,3,8,.12), rgba(2,3,8,.32)), url("${_props.scene.path}")`
							: "linear-gradient(135deg, #272938, #0a0b10)",
					),
				)}
			/>
			<span {...stylex.attrs(styles.backgroundName)}>{_props.scene.name}</span>
		</button>
	);
}
