import * as stylex from "@stylexjs/stylex";
import type { AppInfo } from "../../../../../build/presentation/contracts/AppInfo.ts";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { IconRefreshCw } from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";
export function SidebarFooter(_props: {
	updateAvailable: boolean;
	updateInfo: AppInfo["update"];
	updateStatus: SidebarUpdateStatus;
	updateError?: string;
	onUpdate: () => void;
}) {
	return (
		<>
			{(() => {
				if (!_props.updateAvailable && _props.updateStatus === "idle")
					return null;
				return (
					<div>
						<button
							type="button"
							onClick={_props.onUpdate}
							disabled={
								_props.updateStatus === "updating" ||
								_props.updateStatus === "complete"
							}
							{...stylex.attrs(
								styles.updateButton,
								_props.updateStatus === "updating" && styles.updateButtonBusy,
							)}
						>
							<IconRefreshCw size={iconSize.md} />
							<span {...stylex.attrs(styles.updateLabel)}>
								{_props.updateStatus === "updating"
									? "Updating…"
									: _props.updateStatus === "complete"
										? "Installed — reopen Inferay"
										: _props.updateStatus === "error"
											? "Try update again"
											: `Update to ${_props.updateInfo.latestVersion}`}
							</span>
						</button>
						{_props.updateError && (
							<p role="alert" {...stylex.attrs(styles.updateError)}>
								{_props.updateError}
							</p>
						)}
					</div>
				);
			})()}
		</>
	);
}
export type SidebarUpdateStatus = "idle" | "updating" | "error" | "complete";
