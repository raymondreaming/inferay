import { surfaceStyles } from "@design-system/styles.stylex.ts";
import { IconButton } from "@shared/ui/IconButton/index.tsx";
import { IconX } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createEffect, createSignal } from "solid-js";
import { styles } from "./styles.ts";

export function OperationToast(props: { phase: string; message: string }) {
	const [dismissed, setDismissed] = createSignal(false);
	createEffect(
		() => `${props.phase}\0${props.message}`,
		() => {
			setDismissed(false);
			if (props.phase !== "completed") return;
			const timer = setTimeout(() => setDismissed(true), 4000);
			return () => clearTimeout(timer);
		},
	);
	return (
		<>
			{props.phase !== "idle" && !dismissed() ? (
				<div
					role="status"
					aria-live="polite"
					data-git-operation-phase={props.phase}
					{...stylex.attrs(surfaceStyles.overlay, styles.operationToast)}
				>
					<span>{props.message}</span>
					{props.phase !== "running" ? (
						<IconButton
							size="xs"
							variant="ghost"
							aria-label="Dismiss Git notification"
							onClick={() => setDismissed(true)}
						>
							<IconX size={12} />
						</IconButton>
					) : null}
				</div>
			) : null}
		</>
	);
}
