import {
	recordUiTimings,
	summarizeUiTimings,
	type UiTiming,
} from "@shared/lib/uiPerformance.ts";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, onSettled } from "solid-js";
import { styles } from "./styles.ts";

export default function PerformanceRecorder(props: { onClose: () => void }) {
	const [samples, setSamples] = createSignal<UiTiming[]>([]);
	onSettled(() =>
		recordUiTimings((sample) =>
			setSamples((previous) => [...previous.slice(-99), sample]),
		),
	);
	const summaries = createMemo(() => summarizeUiTimings(samples()));
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
