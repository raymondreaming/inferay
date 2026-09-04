import { layout, prepare } from "@chenglou/pretext";

// Font strings matching the CSS declarations
const UI_FONT =
	"12px Geist, -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
const UI_LINE_HEIGHT = 19.2; // 12px * 1.6

// Cache prepared texts to avoid re-measuring
const cache = new Map<string, ReturnType<typeof prepare>>();

function getPrepared(text: string, font: string): ReturnType<typeof prepare> {
	const key = `${font}::${text}`;
	let p = cache.get(key);
	if (!p) {
		p = prepare(text, font, { whiteSpace: "normal" });
		cache.set(key, p);
		// Keep cache bounded
		if (cache.size > 2000) {
			const first = cache.keys().next().value;
			if (first) cache.delete(first);
		}
	}
	return p;
}
export function measureTextHeight(
	text: string,
	maxWidth: number,
	font: string = UI_FONT,
	lineHeight: number = UI_LINE_HEIGHT,
): number {
	if (!text) return lineHeight;
	const p = getPrepared(text, font);
	const result = layout(p, maxWidth, lineHeight);
	return result.height;
}
