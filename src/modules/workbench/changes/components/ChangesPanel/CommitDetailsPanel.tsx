import * as stylex from "@octanejs/stylex";
import type {
	CommitDetails,
	CommitFile,
} from "../../../../repository/hooks/useGitGraph.tsx";
import type { SelectedFile } from "../../../model/workbench-model.ts";
import { DetailIdentity } from "./DetailIdentity.tsx";
import { HistoricalFileList } from "./HistoricalFileList.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

export function CommitDetailsPanel({
	details,
	selectedFile,
	onSelectFile,
	viewMode,
}: {
	details: CommitDetails;
	selectedFile: SelectedFile | null;
	onSelectFile?: (file: CommitFile) => void;
	viewMode: "path" | "tree";
}) {
	return (
		<div {...stylex.props(styles.detailsRoot)}>
			<div
				data-commit-details-summary="true"
				{...stylex.props(styles.detailsHeader)}
			>
				<p title={details.message} {...stylex.props(styles.commitMessage)}>
					{details.message}
				</p>
				{details.body ? (
					<div
						{...stylex.props(styles.commitDescriptionViewport)}
						style={inlineStyles.getCommitDetailsPanelCommitDescriptionViewportStyle()}
					>
						<p title={details.body} {...stylex.props(styles.commitDescription)}>
							{details.body}
						</p>
					</div>
				) : null}
				<div {...stylex.props(styles.detailIdentityGrid)}>
					<DetailIdentity
						name={details.author}
						email={details.authorEmail}
						date={details.authoredAt}
					/>
				</div>
			</div>
			<div {...stylex.props(styles.scrollArea)}>
				<HistoricalFileList
					files={details.files}
					filePresentation={details.filePresentation}
					selectedFile={selectedFile}
					viewMode={viewMode}
					onSelectFile={onSelectFile}
				/>
			</div>
		</div>
	);
}
