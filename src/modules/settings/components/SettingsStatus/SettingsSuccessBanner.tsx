import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { IconCheck } from "../../../../shared/ui/Icons/index.tsx";
import { Notice } from "../../../../shared/ui/Surface/index.tsx";
export function SettingsSuccessBanner(_props: { message: string }) {
	return (
		<Notice tone="success" icon={<IconCheck size={iconSize._2md} />}>
			{_props.message}
		</Notice>
	);
}
