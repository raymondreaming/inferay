import {
	getIconForFolder,
	getIconForOpenFolder,
} from "@yutengjing/vscode-icons";
import { iconUrls, resolveFileIconUrl } from "../../model/explorer-events.ts";
import * as inlineStyles from "./styles.ts";

export function resolveFolderIconUrl(path: string, open = false): string {
	const name = path.split(/[\\/]/).filter(Boolean).pop() || path;
	const iconFileName = open
		? getIconForOpenFolder(name)
		: getIconForFolder(name);
	return iconUrls.get(iconFileName) ?? resolveFileIconUrl(path);
}

export function FolderTypeIcon({
	path,
	open = false,
	size = 15,
}: {
	readonly path: string;
	readonly open?: boolean;
	readonly size?: number;
}) {
	return (
		<img
			aria-hidden="true"
			alt=""
			draggable={false}
			src={resolveFolderIconUrl(path, open)}
			style={inlineStyles.getFolderTypeIconImgStyle(size, size)}
		/>
	);
}
