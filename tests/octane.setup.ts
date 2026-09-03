import { vi } from "vitest";

globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
	setTimeout(() => callback(performance.now()), 0) as unknown as number;
globalThis.cancelAnimationFrame = (handle: number) => clearTimeout(handle);

globalThis.fetch = vi.fn(
	async () =>
		new Response(JSON.stringify({}), {
			headers: { "content-type": "application/json" },
			status: 200,
		}),
) as typeof fetch;
