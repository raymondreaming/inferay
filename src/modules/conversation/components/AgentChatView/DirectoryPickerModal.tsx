import { Liquid } from "../../../../shared/ui/gooey/index.ts";
import type { ReactNode } from "../../../../types/octane-react-compat.ts";

export function DirectoryPickerModal({ children }: { children: ReactNode }) {
	return (
		<div
			className="inferay-directory-picker-modal"
			role="dialog"
			aria-label="Choose workspace folders"
		>
			<Liquid
				blur={5}
				contrast={20}
				fill="transparent"
				filterPadding={20}
				shadow="none"
				className="inferay-directory-picker-liquid"
			>
				<Liquid.Item observe radius={12}>
					{children}
				</Liquid.Item>
			</Liquid>
		</div>
	);
}
