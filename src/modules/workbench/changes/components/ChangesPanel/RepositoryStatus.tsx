import * as stylex from "@octanejs/stylex";
import { DotMatrixWeave } from "../../../../../shared/ui/DotMatrixLoader/index.tsx";
import { styles } from "./styles.ts";

export function RepositoryStatus({
	projectLoading,
}: {
	projectLoading: boolean;
}) {
	return (
		<div {...stylex.props(styles.emptyState)}>
			{projectLoading ? (
				<div {...stylex.props(styles.loadingState)}>
					<DotMatrixWeave ariaLabel="Checking repository" />
					<span>Checking repository…</span>
				</div>
			) : (
				<p {...stylex.props(styles.emptyText, styles.centerText)}>
					No Git repository
				</p>
			)}
		</div>
	);
}
