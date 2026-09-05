import * as stylex from "@octanejs/stylex";
import {
	IconCloud,
	IconComputer,
	IconGitCommit,
	IconTag,
} from "../../../../../shared/ui/Icons/index.tsx";
import type { GitGraphRefKind } from "../../../../repository/hooks/useGitGraph.tsx";
import { styles } from "./styles.ts";

export function RefIcon({ kind }: { kind: GitGraphRefKind }) {
	const size = 10;
	const symbol =
		kind === "tag"
			? "tag"
			: kind === "remoteBranch"
				? "remote"
				: kind === "stash"
					? "stash"
					: "local";
	const Icon =
		kind === "tag"
			? IconTag
			: kind === "remoteBranch"
				? IconCloud
				: kind === "stash"
					? IconGitCommit
					: IconComputer;
	return (
		<span
			aria-hidden="true"
			data-ref-symbol={symbol}
			{...stylex.props(styles.shrink)}
		>
			<Icon size={size} {...stylex.props(styles.refSymbolIcon)} />
		</span>
	);
}
