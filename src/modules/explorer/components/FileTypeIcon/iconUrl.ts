import { DEFAULT_FILE, getIconForFile } from "@yutengjing/vscode-icons";

// scripts/sync-file-icons.sh copies the package's SVGs here. Requesting them by
// name keeps all 1553 out of the bundle: an eager import.meta.glob built a
// name->hashed-URL map that cost ~340KB of JavaScript to parse, and every view
// importing this component paid it to render a handful of icons.
export function iconUrl(iconFileName: string): string {
	return `/file-icons/${iconFileName}`;
}
export function resolveFileIconUrl(path: string): string {
	const name = path.split(/[\\/]/).pop() || path;
	return iconUrl(getIconForFile(name) ?? DEFAULT_FILE);
}
