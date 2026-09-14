import { type CSSProperties, domStyle } from "@shared/lib/dom.tsx";
import { resolveFileIconUrl } from "./FolderTypeIcon.tsx";
import * as inlineStyles from "./styles.ts";

export { FolderTypeIcon, resolveFolderIconUrl } from "./FolderTypeIcon.tsx";
export function FileTypeIcon(_props: {
	readonly path: string;
	readonly size?: number;
	readonly class?: string;
	readonly style?: CSSProperties;
}) {
	return (
		<img
			aria-hidden="true"
			alt=""
			draggable={false}
			src={resolveFileIconUrl(_props.path)}
			class={_props.class}
			style={domStyle(
				inlineStyles.getFileTypeIconImgStyle(
					_props.size === undefined ? 15 : _props.size,
					_props.size === undefined ? 15 : _props.size,
					_props.style,
				),
			)}
		/>
	);
}
