import type { ProjectEffectIntent } from "@contracts";
import { Button } from "@shared/ui/Button/index.tsx";
import { Modal } from "@shared/ui/Modal/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, Show } from "solid-js";
import { dismissEffect } from "../../services/projectsApi.ts";
import { styles } from "./styles.ts";

export function EffectIntentDialog(props: {
	effect: ProjectEffectIntent;
	close: () => void;
	dismissed: (time: number | null) => Promise<void>;
}) {
	const [pending, setPending] = createSignal(false);
	const [error, setError] = createSignal("");
	async function dismiss() {
		if (pending()) return;
		setPending(true);
		setError("");
		try {
			const result = await dismissEffect({
				id: props.effect.id,
				intentHash: props.effect.intentHash,
			});
			await props.dismissed(result.dismissedAt);
			props.close();
		} catch (error) {
			setError(String(error));
		} finally {
			setPending(false);
		}
	}
	return (
		<Modal
			label="Review intent"
			onClose={props.close}
			closeDisabled={pending()}
			class={stylex.attrs(styles.dialog).class}
		>
			<div {...stylex.attrs(styles.form)}>
				<strong>{props.effect.intent.kind}</strong>
				<p {...stylex.attrs(styles.muted)}>
					{props.effect.intent.target} ·{" "}
					{props.effect.dismissedAt === null ? "Pending review" : "Dismissed"} ·
					Not sent
				</p>
				<Show when={props.effect.intent.notBefore !== null}>
					<p {...stylex.attrs(styles.muted)}>
						Requested for{" "}
						{new Date(props.effect.intent.notBefore!).toLocaleString()}
					</p>
				</Show>
				<pre {...stylex.attrs(styles.pre)}>
					{JSON.stringify(props.effect.intent.payload, null, 2)}
				</pre>
				<p {...stylex.attrs(styles.muted)}>
					Delivery is not available yet. This is the saved proposal; viewing it
					does not send anything.
				</p>
				<Show when={error()}>
					<p role="alert">{error()}</p>
				</Show>
				<div {...stylex.attrs(styles.row)}>
					<Button size="sm" disabled={pending()} onClick={props.close}>
						Close
					</Button>
					<Show when={props.effect.dismissedAt === null}>
						<Button
							size="sm"
							variant="ghost"
							disabled={pending()}
							onClick={() => void dismiss()}
						>
							Dismiss intent
						</Button>
					</Show>
				</div>
			</div>
		</Modal>
	);
}
