import * as stylex from "@octanejs/stylex";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { basename } from "../../../../shared/lib/data.ts";
import { IconX } from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";

export function SelectedDirectoryChip({
	path,
	onRemove,
	strong = false,
	primary = false,
}: {
	path: string;
	onRemove: (path: string) => void;
	strong?: boolean;
	primary?: boolean;
}) {
	return (
		<span
			{...stylex.props(strong ? styles.selectedTagStrong : styles.selectedTag)}
		>
			{strong ? (
				<>
					{primary ? "● " : ""}
					{basename(path)}
				</>
			) : (
				<span {...stylex.props(styles.truncate)}>{basename(path)}</span>
			)}
			<button
				type="button"
				onClick={onRemove.bind(null, path)}
				{...stylex.props(styles.tagRemove)}
			>
				<IconX size={iconSize.xs} />
			</button>
		</span>
	);
}
