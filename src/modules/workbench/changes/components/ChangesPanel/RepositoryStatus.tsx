import * as stylex from "@stylexjs/stylex";
import { DotMatrixWeave } from "../../../../../shared/ui/DotMatrixLoader/index.tsx";
import { styles } from "./styles.ts";
export function RepositoryStatus(_props: { projectLoading: boolean }) {
	return (
		<div {...stylex.attrs(styles.emptyState)}>
			{_props.projectLoading ? (
				<div {...stylex.attrs(styles.loadingState)}>
					<DotMatrixWeave ariaLabel="Checking repository" />
					<span>Checking repository…</span>
				</div>
			) : (
				<p {...stylex.attrs(styles.emptyText, styles.centerText)}>
					No Git repository
				</p>
			)}
		</div>
	);
}
