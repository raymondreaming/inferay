import { iconSize } from "../../../design-system/styles.stylex.ts";
import { IconAlertTriangle, IconCheck } from "../../../shared/ui/Icons.tsx";
import { Notice } from "../../../shared/ui/Surface.tsx";

export function SettingsErrorBanner({ message }: { message: string }) {
	return (
		<Notice tone="warning" icon={<IconAlertTriangle size={iconSize._2md} />}>
			{message}
		</Notice>
	);
}

export function SettingsSuccessBanner({ message }: { message: string }) {
	return (
		<Notice tone="success" icon={<IconCheck size={iconSize._2md} />}>
			{message}
		</Notice>
	);
}
