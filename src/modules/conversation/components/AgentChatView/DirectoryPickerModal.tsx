import type { OctaneNode } from "octane";
import { GooeyRoot } from "../../../../shared/ui/gooey/Gooey/index.tsx";
import { LiquidItem } from "../../../../shared/ui/gooey/LiquidItem/index.tsx";
export function DirectoryPickerModal({ children }: { children: OctaneNode }) {
	return (
		<div
			className="inferay-directory-picker-modal"
			role="dialog"
			aria-label="Choose workspace folders"
		>
			<GooeyRoot
				blur={5}
				contrast={20}
				fill="transparent"
				filterPadding={20}
				shadow="none"
				className="inferay-directory-picker-liquid"
			>
				<LiquidItem observe radius={12}>
					{children}
				</LiquidItem>
			</GooeyRoot>
		</div>
	);
}
