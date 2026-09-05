import * as stylex from "@octanejs/stylex";
import { iconSize } from "../../../../../design-system/styles.stylex.ts";
import { IconButton } from "../../../../../shared/ui/IconButton/index.tsx";
import {
	IconChevronRight,
	IconX,
} from "../../../../../shared/ui/Icons/index.tsx";
import { FileTypeIcon } from "../../../../explorer/components/FileTypeIcon/index.tsx";
import { diffStyles } from "./styles.ts";

export function DiffHeader({
	filePath,
	staged: _staged,
	onClose,
	stats,
	totalChanges,
	onPrevChange,
	onNextChange,
}: {
	filePath: string;
	staged: boolean;
	onClose: () => void;
	stats?: { added: number; removed: number };
	totalChanges?: number;
	onPrevChange?: () => void;
	onNextChange?: () => void;
}) {
	const name = filePath.split("/").pop() || filePath;

	return (
		<div {...stylex.props(diffStyles.header)}>
			<FileTypeIcon path={filePath} size={iconSize.lg} />
			<span {...stylex.props(diffStyles.pathName)}>{name}</span>

			{stats && (stats.added > 0 || stats.removed > 0) && (
				<div {...stylex.props(diffStyles.stats)}>
					{stats.added > 0 && (
						<span {...stylex.props(diffStyles.addedText)}>+{stats.added}</span>
					)}
					{stats.removed > 0 && (
						<span {...stylex.props(diffStyles.deletedText)}>
							−{stats.removed}
						</span>
					)}
				</div>
			)}

			<span {...stylex.props(diffStyles.headerSpacer)} />

			{totalChanges !== undefined &&
				totalChanges > 0 &&
				onPrevChange &&
				onNextChange && (
					<div {...stylex.props(diffStyles.changeNav)}>
						<IconButton
							type="button"
							onClick={onPrevChange}
							variant="ghost"
							size="xs"
							title="Previous change (k/p)"
						>
							<IconChevronRight
								size={iconSize.sm}
								className={stylex.props(diffStyles.rotateHalfTurn).className}
							/>
						</IconButton>
						<span {...stylex.props(diffStyles.changeCount)}>
							{totalChanges}
						</span>
						<IconButton
							type="button"
							onClick={onNextChange}
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
				onClick={onClose}
				variant="ghost"
				size="xs"
				title="Close diff"
			>
				<IconX size={iconSize.xs} />
			</IconButton>
		</div>
	);
}
