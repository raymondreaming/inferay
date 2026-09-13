import { type CSSProperties, domStyle } from "@shared/lib/dom.tsx";
import { DEFAULT_FILE, getIconForFile } from "@yutengjing/vscode-icons";
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
// scripts/sync-file-icons.sh copies the package's SVGs here. Requesting them by
// name keeps all 1553 out of the bundle: an eager import.meta.glob built a
// name->hashed-URL map that cost ~340KB of JavaScript to parse, and every view
// importing this component paid it to render a handful of icons.
export const FILE_ICON_BASE = "/file-icons";
export function iconUrl(iconFileName: string): string {
	return `${FILE_ICON_BASE}/${iconFileName}`;
}
export function resolveFileIconUrl(path: string): string {
	const name = path.split(/[\\/]/).pop() || path;
	return iconUrl(getIconForFile(name) ?? DEFAULT_FILE);
}
