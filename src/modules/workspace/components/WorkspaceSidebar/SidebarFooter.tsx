import * as stylex from "@octanejs/stylex";
import type { AppInfo } from "../../../../app/model/appearance.ts";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { IconRefreshCw } from "../../../../shared/ui/Icons/index.tsx";
import type { SidebarUpdateStatus } from "../../model/workspace-model.ts";
import { styles } from "./styles.ts";

export function SidebarFooter({
	updateAvailable,
	updateInfo,
	updateStatus,
	onUpdate,
}: {
	updateAvailable: boolean;
	updateInfo: AppInfo["update"];
	updateStatus: SidebarUpdateStatus;
	onUpdate: () => void;
}) {
	if (!updateAvailable) return null;
	return (
		<button
			type="button"
			onClick={onUpdate}
			disabled={updateStatus === "updating"}
			{...stylex.props(
				styles.updateButton,
				updateStatus === "updating" && styles.updateButtonBusy,
			)}
		>
			<IconRefreshCw size={iconSize.md} />
			<span {...stylex.props(styles.updateLabel)}>
				{updateStatus === "updating"
					? "Updating…"
					: updateStatus === "error"
						? "Try update again"
						: `Update to ${updateInfo.latestVersion}`}
			</span>
		</button>
	);
}
