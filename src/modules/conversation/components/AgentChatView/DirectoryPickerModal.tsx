import type { Element } from "solid-js";
import { GooeyRoot } from "../../../../shared/ui/gooey/Gooey/index.tsx";
import { LiquidItem } from "../../../../shared/ui/gooey/LiquidItem/index.tsx";
export function DirectoryPickerModal(_props: { children: Element }) {
	return (
		<div
			class="inferay-directory-picker-modal"
			role="dialog"
			aria-label="Choose workspace folders"
		>
			<GooeyRoot
				blur={5}
				contrast={20}
				fill="transparent"
				filterPadding={20}
				shadow="none"
				class="inferay-directory-picker-liquid"
			>
				<LiquidItem observe radius={12}>
					{_props.children}
				</LiquidItem>
			</GooeyRoot>
		</div>
	);
}
