import type { CSSProperties } from "react";
import { resolveFileIconUrl } from "../../model/explorer-events.ts";
import * as inlineStyles from "./styles.ts";

export function FileTypeIcon({
	path,
	size = 15,
	className,
	style,
}: {
	readonly path: string;
	readonly size?: number;
	readonly className?: string;
	readonly style?: CSSProperties;
}) {
	return (
		<img
			aria-hidden="true"
			alt=""
			draggable={false}
			src={resolveFileIconUrl(path)}
			className={className}
			style={inlineStyles.getFileTypeIconImgStyle(size, size, style)}
		/>
	);
}

export { resolveFileIconUrl } from "../../model/explorer-events.ts";
export { FolderTypeIcon, resolveFolderIconUrl } from "./FolderTypeIcon.tsx";
