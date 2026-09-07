import { Dynamic } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import type { GitGraphRefKind } from "../../../../../../build/presentation/contracts/GitGraphRefKind.ts";
import {
	IconCloud,
	IconComputer,
	IconGitCommit,
	IconTag,
} from "../../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";
export function RefIcon(_props: { kind: GitGraphRefKind }) {
	const size = 10;
	const symbol = createMemo(() =>
		_props.kind === "tag"
			? "tag"
			: _props.kind === "remoteBranch"
				? "remote"
				: _props.kind === "stash"
					? "stash"
					: "local",
	);
	const Icon = createMemo(() =>
		_props.kind === "tag"
			? IconTag
			: _props.kind === "remoteBranch"
				? IconCloud
				: _props.kind === "stash"
					? IconGitCommit
					: IconComputer,
	);
	return (
		<span
			aria-hidden="true"
			data-ref-symbol={symbol()}
			{...stylex.attrs(styles.shrink)}
		>
			<Dynamic
				component={Icon()}
				size={size}
				{...stylex.attrs(styles.refSymbolIcon)}
			/>
		</span>
	);
}
