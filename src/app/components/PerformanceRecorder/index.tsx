import type { UiTiming } from "@contracts";
import { project, UiTimingRecorder, uiTrace } from "@shared/lib/native.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, onSettled } from "solid-js";
import { styles } from "./styles.ts";

type UiTimingSummary = Pick<UiTiming, "kind" | "target" | "context"> & {
	count: number;
	medianMs: number;
	p95Ms: number | null;
};

/** Browser probes only. Native state accumulates bounded samples and frame readiness. */
function recordUiTimings(publish: (sample: UiTiming) => void) {
	const model = new UiTimingRecorder();
	let pending: { target: string; kind: UiTiming["kind"] } | null = null;
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
		if (pending)
			for (const entry of entries)
				model.long_task(entry.startTime, entry.duration, performance.now());
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
		const sample: UiTiming = JSON.parse(
			model.finish(result, performance.now()),
		);
		pending = null;
		clearTimeout(deadline);
		publish(sample);
	};
	const begin = (kind: UiTiming["kind"], target: string, timestamp: number) => {
		finish("superseded");
		const now = performance.now();
		const roots = surfaces();
		const root =
			kind === "repository"
				? roots.find((surface) => surface.dataset.repositorySurface === target)
				: panesIn(document).find((pane) => pane.dataset.chatPaneId === target);
		const active = roots.find(
			(surface) => surface.dataset.repositoryActive === "true",
		);
		model.begin(
			kind,
			target,
			JSON.stringify({
				retained: !!root,
				alreadySelected: kind === "repository" && root === active,
				visibleChats: active ? panesIn(active).filter(visible).length : 0,
				activeRuns: document.querySelectorAll("[data-chat-activity]").length,
				viewportWidth: window.innerWidth,
				viewportHeight: window.innerHeight,
				targetWidth: null,
			}),
			timestamp,
			now,
			!!observer,
		);
		pending = { kind, target };
		model.cost(performance.now() - now);
		if (document.visibilityState !== "visible" || !document.hasFocus()) {
			finish("background");
			return;
		}
		deadline = setTimeout(() => finish("timeout"), 5000);
	};
	uiTrace.record = (name) => {
		if (pending) model.stage(name, performance.now());
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
	const ready = (current: NonNullable<typeof pending>, now: number) => {
		const root =
			current.kind === "send"
				? panesIn(document).find(
						(pane) => pane.dataset.chatPaneId === current.target,
					)
				: surfaces().find(
						(surface) =>
							surface.dataset.repositorySurface === current.target &&
							surface.dataset.repositoryActive === "true",
					);
		const panes =
			root && current.kind === "repository"
				? panesIn(root).filter(visible)
				: [];
		return model.frame(
			now,
			performance.now(),
			!!root && visible(root),
			root?.clientWidth ?? 0,
			!!root?.querySelector("[data-chat-activity]"),
			panes.length,
			Number(root?.dataset.expectedPanes),
			panes.every((pane) => pane.dataset.chatReady === "true"),
			panes.some((pane) =>
				pane.querySelector('[data-chat-formatting="pending"]'),
			),
		);
	};
	const tick = (now: number) => {
		if (pending) {
			const started = performance.now();
			const complete = ready(pending, now);
			model.cost(performance.now() - started);
			if (complete) finish("frame-ready");
		}
		frame = requestAnimationFrame(tick);
	};
	const originalFetch = window.fetch;
	function measuredFetch(input: RequestInfo | URL, init?: RequestInit) {
		const current = pending;
		const path = new URL(
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url,
			window.location.href,
		).pathname;
		const index = current ? model.request(path, performance.now()) : undefined;
		return originalFetch.call(window, input, init).finally(() => {
			if (current && pending === current)
				model.response(index, path, performance.now());
		});
	}
	measuredFetch.preconnect = originalFetch.preconnect;
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
		pending = null;
		uiTrace.record = undefined;
		if (window.fetch === measuredFetch) window.fetch = originalFetch;
		observer?.disconnect();
		clearTimeout(deadline);
		cancelAnimationFrame(frame);
		document.removeEventListener("click", click, true);
		document.removeEventListener("keydown", key, true);
		document.removeEventListener("visibilitychange", background);
		window.removeEventListener("blur", background);
		model.free();
	};
}

export default function PerformanceRecorder(props: { onClose: () => void }) {
	const [samples, setSamples] = createSignal<UiTiming[]>([]);
	onSettled(() =>
		recordUiTimings((sample) =>
			setSamples((previous) => [...previous.slice(-99), sample]),
		),
	);
	const summaries = createMemo(() =>
		project<UiTimingSummary[]>("uiTimingSummaries", samples()),
	);
	const ms = (value: number | null) =>
		value === null ? "—" : `${value.toFixed(1)} ms`;
	const download = () => {
		const data = {
			schemaVersion: 2,
			capturedAt: new Date().toISOString(),
			environment: {
				userAgent: navigator.userAgent,
				devicePixelRatio: window.devicePixelRatio,
			},
			summaries: summaries(),
			measured:
				"Click/key event to second animation frame with hydrated panes or send activity; not display paint. Readiness is sampled per frame. HTTP timings end at response headers. Long-task support is feature-detected; null means unavailable. Frame gaps are intervals, not measured dropped frames. Background, superseded, timeout and already-selected samples are excluded from summaries.",
			samples: samples(),
		};
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
		);
		const link = document.createElement("a");
		link.href = url;
		link.download = "inferay-ui-timings.json";
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	};
	return (
		<aside {...stylex.attrs(styles.panel)} aria-label="UI performance recorder">
			<strong>Recording UI timings</strong>
			<p>
				Click repository tabs or send a message. Times include a frame
				opportunity after the panes or activity indicator are ready.
			</p>
			<p>
				These are browser timings, not measured display paint. Recording adds
				some overhead.
			</p>
			<For each={summaries().slice(-4)}>
				{(summary) => (
					<div>
						<strong>
							{summary.target}: median {ms(summary.medianMs)}
						</strong>
						<div>
							{summary.count} comparable samples · p95 {ms(summary.p95Ms)}
						</div>
						<div>
							{summary.context.retained ? "Retained" : "First visit"} ·{" "}
							{summary.context.activeRuns} active runs ·{" "}
							{summary.context.viewportWidth} × {summary.context.viewportHeight}
						</div>
					</div>
				)}
			</For>
			<p>
				Summaries separate destination, retained state, viewport and active
				runs. At least 20 matching samples are needed for p95. Background and
				already-selected clicks are excluded.
			</p>
			<For each={samples().slice(-5)}>
				{(sample) => (
					<div>
						<strong>
							{sample.target} · {sample.kind}: {sample.frameReadyMs.toFixed(1)}{" "}
							ms
						</strong>{" "}
						({sample.result})
						<div>
							Shell {ms(sample.shellReadyMs)} · content{" "}
							{ms(sample.contentReadyMs)} · next frame wait{" "}
							{ms(sample.frameWaitMs)}
						</div>
						<div>
							{sample.context.activeRuns} active runs ·{" "}
							{sample.context.visibleChats} visible chats before click ·{" "}
							{sample.context.retained ? "retained" : "first visit"}
						</div>
						<div>
							{sample.framesOver34Ms} gaps over 34 ms · {sample.framesOver50Ms}{" "}
							over 50 ms
						</div>
						<div>
							{sample.longTasks
								? `${sample.longTasks.count} long tasks · ${sample.longTasks.totalMs.toFixed(1)} ms overlapping this interaction`
								: "Long-task API unavailable in this browser"}
						</div>
						<div>
							Recorder probe time {ms(sample.measurementCostMs)} · last wait:{" "}
							{sample.waitingFor}
						</div>
						<div>
							Input delay {sample.inputDelayMs.toFixed(1)} ms · largest frame
							gap {sample.maxFrameGapMs.toFixed(1)} ms
						</div>
						<div>
							{
								sample.stages.filter((stage) => stage.name === "pane-mounted")
									.length
							}{" "}
							mounts ·{" "}
							{
								sample.stages.filter((stage) => stage.name === "chat:reconnect")
									.length
							}{" "}
							reconnects ·{" "}
							{
								sample.stages.filter((stage) =>
									stage.name.startsWith("request:"),
								).length
							}{" "}
							requests
						</div>
						<details>
							<summary>Request and render timeline</summary>
							<pre>
								{sample.requests
									.map(
										(request) =>
											`${request.path}: ${request.headersMs === null ? "pending at sample end" : ms(request.headersMs)} to headers`,
									)
									.join("\n")}
							</pre>
							<pre>
								{sample.stages
									.map((stage) => `${stage.ms.toFixed(1)} ms ${stage.name}`)
									.join("\n")}
							</pre>
						</details>
					</div>
				)}
			</For>
			<button type="button" onClick={download}>
				Export {samples().length} samples
			</button>
			<button type="button" onClick={props.onClose}>
				Stop recording
			</button>
		</aside>
	);
}
