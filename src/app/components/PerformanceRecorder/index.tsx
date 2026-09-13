import * as stylex from "@stylexjs/stylex";
import { createSignal, For, onSettled } from "solid-js";
import {
	recordUiTimings,
	type UiTiming,
} from "../../../shared/lib/uiPerformance.ts";
import { styles } from "./styles.ts";

export default function PerformanceRecorder(props: { onClose: () => void }) {
	const [samples, setSamples] = createSignal<UiTiming[]>([]);
	onSettled(() =>
		recordUiTimings((sample) =>
			setSamples((previous) => [...previous.slice(-99), sample]),
		),
	);
	const download = () => {
		const data = {
			measured:
				"Input to second animation frame with hydrated visible panes or send activity; a paint opportunity, not a compositor paint measurement.",
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
			<For each={samples().slice(-5)}>
				{(sample) => (
					<div>
						<strong>
							{sample.kind}: {sample.frameReadyMs.toFixed(1)} ms
						</strong>{" "}
						({sample.result})
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
