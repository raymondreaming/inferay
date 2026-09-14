import type { ClassifiedDocument } from "@contracts";
import { postJson } from "@shared/lib/native.tsx";

export async function highlightSyntax(
	input: {
		path: string;
		text: string;
		lineTypes?: string[];
		preview: boolean;
	},
	signal: AbortSignal,
): Promise<ClassifiedDocument | null> {
	const document = await postJson<ClassifiedDocument | null>(
		"/api/native/highlight",
		input,
		{ signal },
		{ message: "Highlight request failed" },
	);
	return document && [1, 2, 3].includes(document.version) ? document : null;
}
