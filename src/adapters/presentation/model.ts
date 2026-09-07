import wasmUrl from "../../../build/presentation/bytes.js";
import {
	initSync,
	presentation,
} from "../../../build/presentation/presentation.js";

// Both prerendering and the browser execute the same Rust models. Bundling the
// bytes also makes initialization independent of the desktop's loopback origin.
initSync({ module: Uint8Array.from(atob(wasmUrl), (c) => c.charCodeAt(0)) });

export function project<T>(operation: string, input: unknown): T {
	return JSON.parse(presentation(operation, JSON.stringify(input)));
}

export {
	ChatReplica,
	ease,
	LiquidBody,
	rounded_rect,
} from "../../../build/presentation/presentation.js";
