import { domStyle } from "@shared/lib/dom.tsx";
import {
	DEFAULT_FILE,
	getIconForFile,
	getIconForFolder,
	getIconForOpenFolder,
} from "@yutengjing/vscode-icons";
import * as inlineStyles from "./styles.ts";

const iconUrl = (iconFileName: string) => `/file-icons/${iconFileName}`;
export function resolveFileIconUrl(path: string): string {
	const name = path.split(/[\\/]/).pop() || path;
	return iconUrl(getIconForFile(name) ?? DEFAULT_FILE);
}
export function resolveFolderIconUrl(path: string, open = false): string {
	const name = path.split(/[\\/]/).filter(Boolean).pop() || path;
	const iconFileName = open
		? getIconForOpenFolder(name)
		: getIconForFolder(name);
	return iconFileName ? iconUrl(iconFileName) : resolveFileIconUrl(path);
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
