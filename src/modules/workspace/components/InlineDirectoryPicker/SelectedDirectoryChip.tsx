import { iconSize, surfaceStyles } from "@design-system/styles.stylex.ts";
import { basename } from "@shared/lib/dom.tsx";
import { IconX } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { styles } from "./styles.ts";
export function SelectedDirectoryChip(_props: {
	path: string;
	onRemove: (path: string) => void;
	strong?: boolean;
}) {
	return (
		<span
			{...stylex.attrs(
				(_props.strong === undefined ? false : _props.strong) &&
					surfaceStyles.overlay,
				(_props.strong === undefined ? false : _props.strong)
					? styles.selectedTagStrong
					: styles.selectedTag,
			)}
		>
			{(_props.strong === undefined ? false : _props.strong) ? (
				basename(_props.path)
			) : (
				<span {...stylex.attrs(styles.truncate)}>{basename(_props.path)}</span>
			)}
			<button
				type="button"
				onClick={_props.onRemove.bind(null, _props.path)}
				{...stylex.attrs(styles.tagRemove)}
			>
				<IconX size={iconSize.sm} />
			</button>
		</span>
	);
}
