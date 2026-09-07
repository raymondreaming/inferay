import * as stylex from "@stylexjs/stylex";
import type { AppInfo } from "../../../../../build/presentation/contracts/AppInfo.ts";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { IconRefreshCw } from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";
export function SidebarFooter(_props: {
	updateAvailable: boolean;
	updateInfo: AppInfo["update"];
	updateStatus: SidebarUpdateStatus;
	onUpdate: () => void;
}) {
	return (
		<>
			{(() => {
				if (!_props.updateAvailable) return null;
				return (
					<button
						type="button"
						onClick={_props.onUpdate}
						disabled={_props.updateStatus === "updating"}
						{...stylex.attrs(
							styles.updateButton,
							_props.updateStatus === "updating" && styles.updateButtonBusy,
						)}
					>
						<IconRefreshCw size={iconSize.md} />
						<span {...stylex.attrs(styles.updateLabel)}>
							{_props.updateStatus === "updating"
								? "Updating…"
								: _props.updateStatus === "error"
									? "Try update again"
									: `Update to ${_props.updateInfo.latestVersion}`}
						</span>
					</button>
				);
			})()}
		</>
	);
}
export type SidebarUpdateStatus = "idle" | "updating" | "error";
