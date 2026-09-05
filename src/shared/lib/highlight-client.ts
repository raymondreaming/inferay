import type { BundledLanguage, BundledTheme } from "shiki";
import type { HighlightToken } from "./highlight-engine.ts";
export type HighlightRequest =
	| { type: "cancel"; id: number }
	| {
			type: "range";
			id: number;
			key: string;
			lines?: string[];
			language: BundledLanguage;
			theme: BundledTheme;
			start: number;
			end: number;
	  };
export type HighlightResponse = {
	id: number;
	rows?: Array<[number, HighlightToken[]]> | null;
	error?: string;
};
let worker: Worker | undefined;
let workerFailed = false;
let nextId = 0;
const registered = new Set<string>();
const pending = new Map<number, (data: HighlightResponse) => void>();
function getWorker() {
	if (worker || workerFailed || typeof Worker === "undefined") return worker;
	try {
		worker = new Worker(new URL("./highlight.worker.ts", import.meta.url), {
			type: "module",
		});
		worker.onmessage = ({ data }: MessageEvent<HighlightResponse>) =>
			pending.get(data.id)?.(data);
		worker.onerror = () => {
			workerFailed = true;
			worker?.terminate();
			worker = undefined;
			registered.clear();
			for (const [id, resolve] of [...pending])
				resolve({
					id,
					error: "Highlight worker failed",
				});
		};
	} catch {
		workerFailed = true;
	}
	return worker;
}
export async function requestHighlight(
	key: string,
	lines: string[],
	language: BundledLanguage,
	theme: BundledTheme,
	start: number,
	end: number,
	signal: AbortSignal,
): Promise<Array<[number, HighlightToken[]]>> {
	if (signal.aborted) return [];
	const target = getWorker();
	if (!target) {
		const engine = await import("./highlight-engine.ts");
		if (signal.aborted) return [];
		engine.registerHighlightDocument(key, lines, language, theme);
		return (await engine.highlightDocumentRange(key, start, end, signal)) ?? [];
	}
	const id = ++nextId;
	return new Promise((resolve) => {
		const finish = (rows: Array<[number, HighlightToken[]]>) => {
			pending.delete(id);
			signal.removeEventListener("abort", cancel);
			clearTimeout(timeout);
			resolve(rows);
		};
		const cancel = () => {
			target.postMessage({
				type: "cancel",
				id,
			} satisfies HighlightRequest);
			finish([]);
		};
		const timeout = setTimeout(cancel, 15000);
		let suppliedDocument = !registered.has(key);
		const send = () =>
			target.postMessage({
				type: "range",
				id,
				key,
				lines: suppliedDocument ? lines : undefined,
				language,
				theme,
				start,
				end,
			} satisfies HighlightRequest);
		pending.set(id, (data) => {
			if (data.rows === null && !suppliedDocument) {
				suppliedDocument = true;
				send();
				return;
			}
			if (data.rows) {
				registered.add(key);
				if (registered.size > 128)
					registered.delete(registered.values().next().value!);
			}
			finish(data.rows ?? []);
		});
		signal.addEventListener("abort", cancel, {
			once: true,
		});
		send();
	});
}
