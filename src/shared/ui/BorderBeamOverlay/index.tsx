import "./beam.css";
import { createEffect, createSignal } from "solid-js";

/** Layered border highlight; keep motion alive until its fade-out finishes. */
export function BorderBeamOverlay(props: { active: boolean }) {
	const [running, setRunning] = createSignal(false);
	createEffect(
		() => props.active,
		(active) => {
			if (active) {
				setRunning(true);
				return;
			}
			const timer = setTimeout(() => setRunning(false), 500);
			return () => clearTimeout(timer);
		},
	);
	return (
		<span
			aria-hidden="true"
			data-beam="inferay"
			data-active={props.active ? "true" : "false"}
			data-running={running() ? "true" : "false"}
		>
			<span data-beam-bloom />
		</span>
	);
}
