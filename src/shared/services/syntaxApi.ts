import { sendJson } from "@shared/lib/native.tsx";

export interface ClassifiedDocument {
	version: number;
	language: string;
	lines: Array<Array<number | string>>;
}

export async function highlightSyntax(
	input: {
		path: string;
		text: string;
		lineTypes?: string[];
		preview: boolean;
	},
	signal: AbortSignal,
): Promise<ClassifiedDocument | null> {
	const response = await sendJson("/api/native/highlight", input, { signal });
	if (!response.ok) throw new Error("Highlight request failed");
	const document: ClassifiedDocument | null = await response.json();
	return document && [1, 2, 3].includes(document.version) ? document : null;
}
