import type { McpToolSource } from "@contracts";
import * as stylex from "@stylexjs/stylex";
import { createSignal, onSettled, Show } from "solid-js";
import { useQueryResource } from "../../../../shared/hooks/useQueryResource.tsx";
import { domStyle, queryClient } from "../../../../shared/lib/dom.tsx";
import { fetchJson } from "../../../../shared/lib/native.tsx";
import { getMcpSourceMarkStyle, styles } from "./styles.ts";

// One refresh timer for the transcript, regardless of how many tool rows mount.
let observers = 0;
let refreshTimer: ReturnType<typeof setInterval> | undefined;

/** Brands one MCP call with its server, falling back to a tinted monogram. */
export function McpSourceMark(props: { source: McpToolSource }) {
	onSettled(() => {
		if (observers++ === 0) {
			refreshTimer = setInterval(() => {
				void queryClient.invalidateQueries({ queryKey: ["mcp-icons"] });
			}, 15_000);
		}
		return () => {
			if (--observers === 0) clearInterval(refreshTimer);
		};
	});
	const icons = useQueryResource(
		() => (signal) =>
			fetchJson<Record<string, string>>("/api/mcp-icons", { signal }),
		() => ({}) as Record<string, string>,
		() => ({
			queryKey: ["mcp-icons"],
			staleTime: 15_000,
		}),
	);
	const [failed, setFailed] = createSignal<Set<string>>(new Set());
	const mark = () => {
		const supplied = icons.data[props.source.serverId];
		return supplied && !failed().has(supplied) ? supplied : undefined;
	};
	return (
		<>
			<span
				aria-hidden="true"
				{...stylex.attrs(
					styles.toolMilestoneMark,
					!!mark() && styles.toolMilestoneBrandMark,
				)}
				style={domStyle(getMcpSourceMarkStyle(props.source.hue))}
			>
				<Show when={mark()} keyed fallback={props.source.monogram}>
					{(src) => (
						<img
							src={src}
							alt=""
							width={14}
							height={14}
							draggable={false}
							onError={() =>
								setFailed((previous) => new Set([...previous, src]))
							}
						/>
					)}
				</Show>
			</span>
			<span {...stylex.attrs(styles.toolMilestoneSource)}>
				{props.source.serverLabel}
			</span>
			<span aria-hidden="true" {...stylex.attrs(styles.toolMilestoneSeparator)}>
				·
			</span>
		</>
	);
}
