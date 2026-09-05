import { DEFAULT_FILE, getIconForFile } from "@yutengjing/vscode-icons";

const importedIcons = import.meta.glob(
	"../../../../../node_modules/@yutengjing/vscode-icons/assets/icons/*.svg",
	{ eager: true, import: "default", query: "?url" },
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
