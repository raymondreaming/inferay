import { DEFAULT_FILE, getIconForFile } from "@yutengjing/vscode-icons";
import type { CSSProperties } from "react";

const importedIcons = import.meta.glob(
	"../../../node_modules/@yutengjing/vscode-icons/assets/icons/*.svg",
	{ eager: true, import: "default", query: "?url" },
) as Record<string, string>;

const iconUrls = new Map(
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
			style={{
				width: size,
				height: size,
				flexShrink: 0,
				opacity: 0.82,
				filter: "saturate(0.58) brightness(0.9)",
				...style,
			}}
		/>
	);
}
