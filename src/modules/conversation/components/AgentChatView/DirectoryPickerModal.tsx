import type { Element } from "solid-js";
export function DirectoryPickerModal(_props: { children: Element }) {
	return (
		<div
			class="inferay-directory-picker-modal"
			role="dialog"
			aria-label="Choose workspace folders"
		>
			{_props.children}
		</div>
	);
}
