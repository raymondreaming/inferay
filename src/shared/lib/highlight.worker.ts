import type {
	HighlightRequest,
	HighlightResponse,
} from "./highlight-client.ts";
import {
	highlightDocumentRange,
	registerHighlightDocument,
} from "./highlight-engine.ts";

const active = new Map<number, AbortController>();
self.onmessage = async ({ data }: MessageEvent<HighlightRequest>) => {
	if (data.type === "cancel") {
		active.get(data.id)?.abort();
		return;
	}
	const controller = new AbortController();
	active.set(data.id, controller);
	let rows: HighlightResponse["rows"];
	try {
		if (data.lines)
			registerHighlightDocument(
				data.key,
				data.lines,
				data.language,
				data.theme,
			);
		rows = await highlightDocumentRange(
			data.key,
			data.start,
			data.end,
			controller.signal,
		);
	} catch {
	} finally {
		active.delete(data.id);
	}
	if (!controller.signal.aborted)
		self.postMessage({ id: data.id, rows } satisfies HighlightResponse);
};
