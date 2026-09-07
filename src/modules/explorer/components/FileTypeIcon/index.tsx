import { DEFAULT_FILE, getIconForFile } from "@yutengjing/vscode-icons";
import { type CSSProperties, domStyle } from "../../../../shared/lib/dom.tsx";
import * as inlineStyles from "./styles.ts";
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
export { FolderTypeIcon, resolveFolderIconUrl } from "./FolderTypeIcon.tsx";

const importedIcons = import.meta.glob(
	"/node_modules/@yutengjing/vscode-icons/assets/icons/*.svg",
	{
		eager: true,
		import: "default",
		query: "?url&no-inline",
	},
) as Record<string, string>;
export const iconUrls = new Map(
	Object.entries(importedIcons).map(([modulePath, url]) => [
		modulePath.slice(modulePath.lastIndexOf("/") + 1),
		url,
	]),
);
export function resolveFileIconUrl(path: string): string {
	const name = path.split(/[\\/]/).pop() || path;
	const iconFileName = getIconForFile(name) ?? DEFAULT_FILE;
	return iconUrls.get(iconFileName) ?? iconUrls.get(DEFAULT_FILE)!;
}
