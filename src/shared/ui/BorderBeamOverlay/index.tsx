import "./beam.css";

/** Compositor-driven border highlight for an active composer. */
export function BorderBeamOverlay(props: { active: boolean }) {
	return (
		<span
			aria-hidden="true"
			class="inferay-border-beam"
			data-active={props.active ? "true" : "false"}
		/>
	);
}
