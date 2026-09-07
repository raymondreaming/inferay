import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { IconAlertTriangle } from "../../../../shared/ui/Icons/index.tsx";
import { Notice } from "../../../../shared/ui/Surface/index.tsx";
export function SettingsErrorBanner(_props: { message: string }) {
	return (
		<Notice tone="warning" icon={<IconAlertTriangle size={iconSize._2md} />}>
			{_props.message}
		</Notice>
	);
}
export { SettingsSuccessBanner } from "./SettingsSuccessBanner.tsx";
