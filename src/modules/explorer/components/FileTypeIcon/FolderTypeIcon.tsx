import {
	getIconForFolder,
	getIconForOpenFolder,
} from "@yutengjing/vscode-icons";
import { domStyle } from "../../../../shared/lib/dom.tsx";
import { iconUrls, resolveFileIconUrl } from "./index.tsx";
import * as inlineStyles from "./styles.ts";
export function resolveFolderIconUrl(path: string, open = false): string {
	const name = path.split(/[\\/]/).filter(Boolean).pop() || path;
	const iconFileName = open
		? getIconForOpenFolder(name)
		: getIconForFolder(name);
	return iconUrls.get(iconFileName) ?? resolveFileIconUrl(path);
}
export function FolderTypeIcon(_props: {
	readonly path: string;
	readonly open?: boolean;
	readonly size?: number;
}) {
	return (
		<img
			aria-hidden="true"
			alt=""
			draggable={false}
			src={resolveFolderIconUrl(
				_props.path,
				_props.open === undefined ? false : _props.open,
			)}
			style={domStyle(
				inlineStyles.getFolderTypeIconImgStyle(
					_props.size === undefined ? 15 : _props.size,
					_props.size === undefined ? 15 : _props.size,
				),
			)}
		/>
	);
}
