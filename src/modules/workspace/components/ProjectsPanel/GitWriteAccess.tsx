import * as stylex from "@stylexjs/stylex";
import { For, Show } from "solid-js";
import { styles } from "./styles.ts";

export function GitWriteAccess(props: { paths: string[] }) {
	return (
		<Show when={props.paths.length > 0}>
			<section aria-label="Git metadata write access">
				<strong>Git metadata write access</strong>
				<p {...stylex.attrs(styles.muted)}>
					Commits can update these locations, including metadata shared with
					other worktrees.
				</p>
				<div role="list">
					<For each={props.paths} keyed={(path) => path}>
						{(path) => (
							<div role="listitem" {...stylex.attrs(styles.muted)}>
								<code>{path()}</code>
							</div>
						)}
					</For>
				</div>
			</section>
		</Show>
	);
}
