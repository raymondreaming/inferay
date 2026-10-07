import type { ConnectionAccess } from "@contracts";
import * as stylex from "@stylexjs/stylex";
import { For, Show } from "solid-js";
import { styles } from "./styles.ts";

export function ConnectionReview(props: { connections: ConnectionAccess[] }) {
	return (
		<Show when={props.connections.length > 0}>
			<section
				aria-label="Requested connections"
				{...stylex.attrs(styles.connectionReview)}
			>
				<strong>Requested connections</strong>
				<For each={props.connections}>
					{(access) => (
						<div>
							<div {...stylex.attrs(styles.row)}>
								<strong>{access.connection.name}</strong>
								<span {...stylex.attrs(styles.muted)}>
									{access.toolName} · {access.alias}
								</span>
							</div>
							<p {...stylex.attrs(styles.muted)}>{access.request.baseUrl}</p>
							<code>
								{access.request.header}: {access.request.prefix}[key]
							</code>
						</div>
					)}
				</For>
				<p {...stylex.attrs(styles.muted)}>
					Approval records the current key revision. Replacing or removing the
					key requires a new review.
				</p>
				<p role="status" {...stylex.attrs(styles.muted)}>
					Credential delivery is not available yet. These runs remain blocked.
				</p>
			</section>
		</Show>
	);
}
