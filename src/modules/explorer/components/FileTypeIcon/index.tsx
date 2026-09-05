import type { CSSProperties } from "react";
import { resolveFileIconUrl } from "./shared.ts";
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

export { FolderTypeIcon, resolveFolderIconUrl } from "./FolderTypeIcon.tsx";
export { resolveFileIconUrl } from "./shared.ts";
