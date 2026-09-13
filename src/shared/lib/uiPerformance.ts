export type UiTiming = {
	kind: "repository" | "send";
	result: "frame-ready" | "timeout" | "superseded";
	inputDelayMs: number;
	frameReadyMs: number;
	maxFrameGapMs: number;
	stages: { name: string; ms: number }[];
};
let recordStage: ((name: string) => void) | undefined;
/** No observers, timers or accumulated data unless the recorder is open. */
export function traceUi(name: string) {
	recordStage?.(name);
}

export function recordUiTimings(publish: (sample: UiTiming) => void) {
	let pending: {
		sample: UiTiming;
		target: string;
		start: number;
		lastFrame: number;
		readyFrame: boolean;
	} | null = null;
	let frame = 0;
	const finish = (result: UiTiming["result"]) => {
		if (!pending) return;
		const sample = pending.sample;
		sample.result = result;
		sample.frameReadyMs = performance.now() - pending.start;
		pending = null;
		publish(sample);
	};
	const begin = (kind: UiTiming["kind"], target: string, timestamp: number) => {
		finish("superseded");
		const now = performance.now();
		const start = timestamp > 0 && timestamp <= now ? timestamp : now;
		pending = {
			target,
			start,
			lastFrame: now,
			readyFrame: false,
			sample: {
				kind,
				result: "timeout",
				inputDelayMs: now - start,
				frameReadyMs: 0,
				maxFrameGapMs: 0,
				stages: [],
			},
		};
	};
	recordStage = (name) => {
		if (pending && pending.sample.stages.length < 256)
			pending.sample.stages.push({
				name,
				ms: performance.now() - pending.start,
			});
	};
	const click = (event: MouseEvent) => {
		const tab =
			event.target instanceof Element
				? event.target.closest<HTMLElement>("[data-repository-tab]")
				: null;
		if (tab) begin("repository", tab.dataset.repositoryTab!, event.timeStamp);
	};
	const key = (event: KeyboardEvent) => {
		if (
			event.key !== "Enter" ||
			event.shiftKey ||
			event.isComposing ||
			event.repeat ||
			event.keyCode === 229
		)
			return;
		if (!(event.target instanceof HTMLTextAreaElement)) return;
		const pane = event.target.closest<HTMLElement>("[data-chat-pane-id]");
		if (pane) begin("send", pane.dataset.chatPaneId!, event.timeStamp);
	};
	const visible = (node: HTMLElement) =>
		node.getClientRects().length > 0 && node.clientHeight > 0;
	const ready = () => {
		if (!pending) return false;
		if (pending.sample.kind === "send") {
			if (!pending.sample.stages.some((stage) => stage.name === "chat:send"))
				return false;
			const pane = [
				...document.querySelectorAll<HTMLElement>("[data-chat-pane-id]"),
			].find(
				(pane) => pane.dataset.chatPaneId === pending?.target && visible(pane),
			);
			return !!pane?.querySelector("[data-chat-activity]");
		}
		const surface = [
			...document.querySelectorAll<HTMLElement>(
				'[data-repository-active="true"]',
			),
		].find((surface) => surface.dataset.repositorySurface === pending?.target);
		if (!surface || !visible(surface)) return false;
		const panes = [
			...surface.querySelectorAll<HTMLElement>("[data-chat-pane-id]"),
		].filter(visible);
		return (
			panes.length === Number(surface.dataset.expectedPanes) &&
			panes.every(
				(pane) =>
					pane.dataset.chatReady === "true" &&
					!pane.querySelector('[data-chat-formatting="pending"]') &&
					visible(pane),
			)
		);
	};
	const tick = (now: number) => {
		if (pending) {
			pending.sample.maxFrameGapMs = Math.max(
				pending.sample.maxFrameGapMs,
				now - pending.lastFrame,
			);
			pending.lastFrame = now;
			const isReady = ready();
			if (isReady && pending.readyFrame) finish("frame-ready");
			else if (now - pending.start > 5000) finish("timeout");
			else pending.readyFrame = isReady;
		}
		frame = requestAnimationFrame(tick);
	};
	const originalFetch = window.fetch;
	const measuredFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		const current = pending;
		const path = new URL(
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url,
			window.location.href,
		).pathname;
		if (current && current.sample.stages.length < 256)
			current.sample.stages.push({
				name: `request:${path}`,
				ms: performance.now() - current.start,
			});
		return originalFetch.call(window, input, init).finally(() => {
			if (current && pending === current && current.sample.stages.length < 256)
				current.sample.stages.push({
					name: `response:${path}`,
					ms: performance.now() - current.start,
				});
		});
	}) as typeof fetch;
	window.fetch = measuredFetch;
	document.addEventListener("click", click, true);
	document.addEventListener("keydown", key, true);
	frame = requestAnimationFrame(tick);
	return () => {
		recordStage = undefined;
		if (window.fetch === measuredFetch) window.fetch = originalFetch;
		cancelAnimationFrame(frame);
		document.removeEventListener("click", click, true);
		document.removeEventListener("keydown", key, true);
	};
}
