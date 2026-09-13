export type UiTiming = {
	kind: "repository" | "send";
	result: "frame-ready" | "timeout" | "superseded" | "background";
	target: string;
	context: {
		retained: boolean;
		alreadySelected: boolean;
		visibleChats: number;
		activeRuns: number;
		viewportWidth: number;
		viewportHeight: number;
		targetWidth: number | null;
	};
	inputDelayMs: number;
	shellReadyMs: number | null;
	contentReadyMs: number | null;
	frameWaitMs: number | null;
	frameReadyMs: number;
	maxFrameGapMs: number;
	frameGapsMs: number[];
	framesOver34Ms: number;
	framesOver50Ms: number;
	measurementCostMs: number;
	waitingFor: string;
	longTasks: { count: number; totalMs: number; maxMs: number } | null;
	requests: { path: string; startMs: number; headersMs: number | null }[];
	stages: { name: string; ms: number }[];
};
let recordStage: ((name: string) => void) | undefined;
/** No observers, timers or accumulated data unless the recorder is open. */
export function traceUi(name: string) {
	recordStage?.(name);
}

/** Compare the same destination, viewport, retained state and streaming load. */
export function summarizeUiTimings(samples: UiTiming[]) {
	const groups = new Map<string, UiTiming[]>();
	for (const sample of samples) {
		if (sample.result !== "frame-ready" || sample.context.alreadySelected)
			continue;
		const key = JSON.stringify([sample.kind, sample.target, sample.context]);
		const group = groups.get(key) ?? [];
		group.push(sample);
		groups.set(key, group);
	}
	return [...groups.values()].map((group) => {
		const sorted = group
			.map((sample) => sample.frameReadyMs)
			.sort((a, b) => a - b);
		return {
			kind: group[0].kind,
			target: group[0].target,
			context: group[0].context,
			count: group.length,
			medianMs:
				(sorted[Math.floor((sorted.length - 1) / 2)] +
					sorted[Math.floor(sorted.length / 2)]) /
				2,
			// A handful of clicks cannot provide a useful tail-latency estimate.
			p95Ms:
				sorted.length >= 20
					? sorted[Math.ceil(sorted.length * 0.95) - 1]
					: null,
		};
	});
}

export function recordUiTimings(publish: (sample: UiTiming) => void) {
	type Pending = {
		sample: UiTiming;
		target: string;
		start: number;
		lastFrame: number;
		readyFrame: boolean;
	};
	let pending: Pending | null = null;
	let frame = 0;
	let deadline: ReturnType<typeof setTimeout> | undefined;
	let observer: PerformanceObserver | undefined;
	const visible = (node: HTMLElement) =>
		node.getClientRects().length > 0 && node.clientHeight > 0;
	const surfaces = () => [
		...document.querySelectorAll<HTMLElement>("[data-repository-surface]"),
	];
	const panesIn = (root: ParentNode) => [
		...root.querySelectorAll<HTMLElement>("[data-chat-pane-id]"),
	];
	const addLongTasks = (entries: PerformanceEntry[]) => {
		if (!pending?.sample.longTasks) return;
		for (const entry of entries) {
			if (entry.startTime + entry.duration <= pending.start) continue;
			const overlap =
				Math.min(performance.now(), entry.startTime + entry.duration) -
				Math.max(pending.start, entry.startTime);
			if (overlap <= 0) continue;
			const tasks = pending.sample.longTasks;
			tasks.count++;
			tasks.totalMs += overlap;
			tasks.maxMs = Math.max(tasks.maxMs, entry.duration);
		}
	};
	if (
		typeof PerformanceObserver !== "undefined" &&
		PerformanceObserver.supportedEntryTypes?.includes("longtask")
	) {
		try {
			observer = new PerformanceObserver((list) =>
				addLongTasks(list.getEntries()),
			);
			observer.observe({ type: "longtask" });
		} catch {
			observer?.disconnect();
			observer = undefined;
		}
	}
	const finish = (result: UiTiming["result"]) => {
		if (!pending) return;
		if (observer) addLongTasks(observer.takeRecords());
		const sample = pending.sample;
		sample.result = result;
		sample.frameReadyMs = performance.now() - pending.start;
		if (result === "frame-ready" && sample.contentReadyMs !== null)
			sample.frameWaitMs = sample.frameReadyMs - sample.contentReadyMs;
		pending = null;
		clearTimeout(deadline);
		publish(sample);
	};
	const begin = (kind: UiTiming["kind"], target: string, timestamp: number) => {
		finish("superseded");
		const now = performance.now();
		const start = timestamp > 0 && timestamp <= now ? timestamp : now;
		const roots = surfaces();
		const root =
			kind === "repository"
				? roots.find((surface) => surface.dataset.repositorySurface === target)
				: panesIn(document).find((pane) => pane.dataset.chatPaneId === target);
		const active = roots.find(
			(surface) => surface.dataset.repositoryActive === "true",
		);
		pending = {
			target,
			start,
			lastFrame: now,
			readyFrame: false,
			sample: {
				kind,
				result: "timeout",
				target:
					kind === "repository"
						? (target.split("/").filter(Boolean).at(-1) ?? target)
						: target,
				context: {
					retained: !!root,
					alreadySelected: kind === "repository" && root === active,
					visibleChats: active ? panesIn(active).filter(visible).length : 0,
					activeRuns: document.querySelectorAll("[data-chat-activity]").length,
					viewportWidth: window.innerWidth,
					viewportHeight: window.innerHeight,
					targetWidth: null,
				},
				inputDelayMs: now - start,
				shellReadyMs: null,
				contentReadyMs: null,
				frameWaitMs: null,
				frameReadyMs: 0,
				maxFrameGapMs: 0,
				frameGapsMs: [],
				framesOver34Ms: 0,
				framesOver50Ms: 0,
				measurementCostMs: performance.now() - now,
				waitingFor: "activation",
				longTasks: observer ? { count: 0, totalMs: 0, maxMs: 0 } : null,
				requests: [],
				stages: [],
			},
		};
		if (document.visibilityState !== "visible" || !document.hasFocus()) {
			finish("background");
			return;
		}
		// Unlike a frame-based timeout, this also terminates samples when rAF pauses.
		deadline = setTimeout(() => finish("timeout"), 5000);
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
	const ready = (current: Pending) => {
		const sample = current.sample;
		const root =
			sample.kind === "send"
				? panesIn(document).find(
						(pane) => pane.dataset.chatPaneId === current.target,
					)
				: surfaces().find(
						(surface) =>
							surface.dataset.repositorySurface === current.target &&
							surface.dataset.repositoryActive === "true",
					);
		if (!root || !visible(root)) {
			sample.waitingFor = "activation";
			return false;
		}
		if (sample.shellReadyMs === null) {
			sample.shellReadyMs = performance.now() - current.start;
			sample.context.targetWidth = Math.round(root.clientWidth);
			recordStage?.("shell-visible");
		}
		if (sample.kind === "send") {
			const sent = sample.stages.some((stage) => stage.name === "chat:send");
			sample.waitingFor = sent ? "activity indicator" : "send accepted";
			return sent && !!root.querySelector("[data-chat-activity]");
		}
		const panes = panesIn(root).filter(visible);
		if (panes.length !== Number(root.dataset.expectedPanes)) {
			sample.waitingFor = "pane layout";
			return false;
		}
		if (panes.some((pane) => pane.dataset.chatReady !== "true")) {
			sample.waitingFor = "transcript hydration";
			return false;
		}
		if (
			panes.some((pane) =>
				pane.querySelector('[data-chat-formatting="pending"]'),
			)
		) {
			sample.waitingFor = "Markdown formatting";
			return false;
		}
		return true;
	};
	const tick = (now: number) => {
		if (pending) {
			const started = performance.now();
			const sample = pending.sample;
			const gap = Math.max(0, now - pending.lastFrame);
			sample.maxFrameGapMs = Math.max(sample.maxFrameGapMs, gap);
			if (sample.frameGapsMs.length < 600) sample.frameGapsMs.push(gap);
			if (gap > 34) sample.framesOver34Ms++;
			if (gap > 50) sample.framesOver50Ms++;
			pending.lastFrame = now;
			const isReady = ready(pending);
			if (isReady && sample.contentReadyMs === null) {
				sample.contentReadyMs = performance.now() - pending.start;
				recordStage?.("content-ready");
			}
			if (!isReady) sample.contentReadyMs = null;
			if (isReady) sample.waitingFor = "next frame";
			const complete = isReady && pending.readyFrame;
			pending.readyFrame = isReady;
			sample.measurementCostMs += performance.now() - started;
			if (complete) finish("frame-ready");
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
		const request = {
			path,
			startMs: current ? performance.now() - current.start : 0,
			headersMs: null as number | null,
		};
		if (current && current.sample.requests.length < 256) {
			current.sample.requests.push(request);
			recordStage?.(`request:${path}`);
		}
		return originalFetch.call(window, input, init).finally(() => {
			if (current && pending === current) {
				request.headersMs = performance.now() - current.start - request.startMs;
				recordStage?.(`response:${path}`);
			}
		});
	}) as typeof fetch;
	const background = () => {
		if (document.visibilityState !== "visible" || !document.hasFocus())
			finish("background");
	};
	window.fetch = measuredFetch;
	document.addEventListener("click", click, true);
	document.addEventListener("keydown", key, true);
	document.addEventListener("visibilitychange", background);
	window.addEventListener("blur", background);
	frame = requestAnimationFrame(tick);
	return () => {
		recordStage = undefined;
		if (window.fetch === measuredFetch) window.fetch = originalFetch;
		observer?.disconnect();
		clearTimeout(deadline);
		cancelAnimationFrame(frame);
		document.removeEventListener("click", click, true);
		document.removeEventListener("keydown", key, true);
		document.removeEventListener("visibilitychange", background);
		window.removeEventListener("blur", background);
	};
}
