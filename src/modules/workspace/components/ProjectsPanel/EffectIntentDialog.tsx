import type { ProjectEffectIntent } from "@contracts";
import { Button } from "@shared/ui/Button/index.tsx";
import { Modal } from "@shared/ui/Modal/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, Show } from "solid-js";
import { effectStatus } from "../../model/projectEffects.ts";
import { cancelEffect, dismissEffect } from "../../services/projectsApi.ts";
import { styles } from "./styles.ts";

export function EffectIntentDialog(props: {
	effect: ProjectEffectIntent;
	close: () => void;
	changed: (effect: ProjectEffectIntent) => Promise<void>;
}) {
	const [pending, setPending] = createSignal(false);
	const [error, setError] = createSignal("");
	async function change(cancel: boolean) {
		if (pending()) return;
		setPending(true);
		setError("");
		try {
			const request = {
				id: props.effect.id,
				intentHash: props.effect.intentHash,
			};
			const effect = cancel
				? { ...props.effect, delivery: await cancelEffect(request) }
				: { ...props.effect, ...(await dismissEffect(request)) };
			await props.changed(effect);
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
					{props.effect.intent.target} · {effectStatus(props.effect)}
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
					{props.effect.delivery
						? "Stopping an attempt does not undo a completed action. Its receipt determines the outcome."
						: "Delivery is not available yet. Viewing this proposal does not send anything."}
				</p>
				<Show when={props.effect.delivery?.receipt} keyed>
					{(receipt) => (
						<p {...stylex.attrs(styles.muted)}>
							Receipt {receipt.destinationId} ·{" "}
							{new Date(receipt.completedAt).toLocaleString()}
						</p>
					)}
				</Show>
				<Show when={error()}>
					<p role="alert">{error()}</p>
				</Show>
				<div {...stylex.attrs(styles.row)}>
					<Show
						when={
							props.effect.delivery &&
							["queued", "in_flight", "uncertain"].includes(
								props.effect.delivery.state,
							) &&
							props.effect.delivery.cancellationRequestedAt === null
						}
					>
						<Button
							size="sm"
							variant="ghost"
							disabled={pending()}
							onClick={() => void change(true)}
						>
							{props.effect.delivery?.state === "queued"
								? "Cancel delivery"
								: "Request stop"}
						</Button>
					</Show>
					<Button size="sm" disabled={pending()} onClick={props.close}>
						Close
					</Button>
					<Show
						when={props.effect.dismissedAt === null && !props.effect.delivery}
					>
						<Button
							size="sm"
							variant="ghost"
							disabled={pending()}
							onClick={() => void change(false)}
						>
							Dismiss intent
						</Button>
					</Show>
				</div>
			</div>
		</Modal>
	);
}
