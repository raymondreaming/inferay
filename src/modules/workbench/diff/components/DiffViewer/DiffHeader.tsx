import * as stylex from "@stylexjs/stylex";
import { iconSize } from "../../../../../design-system/styles.stylex.ts";
import { basename } from "../../../../../shared/lib/dom.tsx";
import { IconButton } from "../../../../../shared/ui/IconButton/index.tsx";
import {
	IconChevronRight,
	IconX,
} from "../../../../../shared/ui/Icons/index.tsx";
import { FileTypeIcon } from "../../../../explorer/components/FileTypeIcon/index.tsx";
import { diffStyles } from "./styles.ts";
export function DiffHeader(_props: {
	filePath: string;
	staged: boolean;
	onClose: () => void;
	stats?: {
		added: number;
		removed: number;
	};
	totalChanges?: number;
	onPrevChange?: () => void;
	onNextChange?: () => void;
}) {
	return (
		<div {...stylex.attrs(diffStyles.header)}>
			<FileTypeIcon path={_props.filePath} size={iconSize.lg} />
			<span {...stylex.attrs(diffStyles.pathName)}>
				{basename(_props.filePath)}
			</span>

			{_props.stats && (_props.stats.added > 0 || _props.stats.removed > 0) && (
				<div {...stylex.attrs(diffStyles.stats)}>
					{_props.stats.added > 0 && (
						<span {...stylex.attrs(diffStyles.addedText)}>
							+{_props.stats.added}
						</span>
					)}
					{_props.stats.removed > 0 && (
						<span {...stylex.attrs(diffStyles.deletedText)}>
							−{_props.stats.removed}
						</span>
					)}
				</div>
			)}

			<span {...stylex.attrs(diffStyles.headerSpacer)} />

			{_props.totalChanges !== undefined &&
				_props.totalChanges > 0 &&
				_props.onPrevChange &&
				_props.onNextChange && (
					<div {...stylex.attrs(diffStyles.changeNav)}>
						<IconButton
							type="button"
							onClick={_props.onPrevChange}
							variant="ghost"
							size="xs"
							title="Previous change (k/p)"
						>
							<IconChevronRight
								size={iconSize.sm}
								class={stylex.attrs(diffStyles.rotateHalfTurn).class}
							/>
						</IconButton>
						<span {...stylex.attrs(diffStyles.changeCount)}>
							{_props.totalChanges}
						</span>
						<IconButton
							type="button"
							onClick={_props.onNextChange}
							variant="ghost"
							size="xs"
							title="Next change (j/n)"
						>
							<IconChevronRight size={iconSize.sm} />
						</IconButton>
					</div>
				)}

			<IconButton
				type="button"
				onClick={_props.onClose}
				variant="ghost"
				size="xs"
				title="Close diff"
			>
				<IconX size={iconSize.xs} />
			</IconButton>
		</div>
	);
}
