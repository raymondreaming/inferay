import * as stylex from "@stylexjs/stylex";
import { Show } from "solid-js";
import type { McpToolSource } from "../../../../../build/presentation/contracts/McpToolSource.ts";
import { domStyle } from "../../../../shared/lib/dom.tsx";
import { brandMark } from "./mcpBrands.tsx";
import { getMcpSourceMarkStyle, styles } from "./styles.ts";

/** Brands one MCP call with its server, falling back to a tinted monogram. */
export function McpSourceMark(props: { source: McpToolSource }) {
	const mark = () => brandMark(props.source.serverId);
	return (
		<>
			<span
				aria-hidden="true"
				{...stylex.attrs(styles.toolMilestoneMark)}
				style={domStyle(getMcpSourceMarkStyle(props.source.hue))}
			>
				<Show when={mark()} keyed fallback={props.source.monogram}>
					{(Mark) => <Mark />}
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
