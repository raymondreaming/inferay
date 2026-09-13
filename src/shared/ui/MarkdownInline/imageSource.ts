/** Local images must be served by the host rather than the webview's origin. */
export function markdownImageSource(
	href: string | undefined,
): string | undefined {
	if (!href) return undefined;
	let path = href;
	if (href.startsWith("file:")) {
		try {
			const url = new URL(href);
			if (url.hostname && url.hostname !== "localhost") return undefined;
			path = decodeURIComponent(url.pathname);
		} catch {
			return undefined;
		}
	} else if (href.startsWith("sandbox:/")) {
		path = href.slice("sandbox:".length);
	}
	if (
		path.startsWith("/") &&
		!path.startsWith("//") &&
		!path.startsWith("/api/")
	) {
		return `/api/file?path=${encodeURIComponent(path)}`;
	}
	return path;
}
