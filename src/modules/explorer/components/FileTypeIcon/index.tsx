import { px } from "@shared/lib/dom.tsx";
import { resolveFileIconUrl } from "./FolderTypeIcon.tsx";

export { FolderTypeIcon, resolveFolderIconUrl } from "./FolderTypeIcon.tsx";
export function FileTypeIcon(_props: {
	readonly path: string;
	readonly size?: number;
	readonly class?: string;
}) {
	return (
		<img
			aria-hidden="true"
			alt=""
			draggable={false}
			src={resolveFileIconUrl(_props.path)}
			class={_props.class}
			style={{
				width: _props.size === undefined ? "15px" : px(_props.size),
				height: _props.size === undefined ? "15px" : px(_props.size),
				"flex-shrink": 0,
				opacity: 0.96,
				filter: "saturate(0.76) brightness(1.08)",
			}}
		/>
	);
}
