import * as stylex from "@octanejs/stylex";
import { InlineDirectoryPicker } from "../../../workspace/components/InlineDirectoryPicker/index.tsx";
import { DirectoryPickerModal } from "./DirectoryPickerModal.tsx";
import { styles } from "./styles.ts";

export function ChatWorkspacePicker({
	savePendingWorkspaceSelection,
	onDirectoryCancel,
	paneId,
}: {
	savePendingWorkspaceSelection: (paths: string[]) => void;
	onDirectoryCancel: ((paneId: string) => void) | undefined;
	paneId: string;
}) {
	return (
		<div {...stylex.props(styles.directoryPickerWrap)}>
			<DirectoryPickerModal>
				<div {...stylex.props(styles.directoryPickerInner)}>
					<InlineDirectoryPicker
						onSelect={(path) => {
							if (path) savePendingWorkspaceSelection([path]);
							else {
								savePendingWorkspaceSelection([]);
								onDirectoryCancel?.(paneId);
							}
						}}
						onCancel={() => {
							savePendingWorkspaceSelection([]);
							onDirectoryCancel?.(paneId);
						}}
						multiSelect
						showStartButton={false}
						onSelectionChange={(paths) => {
							savePendingWorkspaceSelection(paths);
						}}
						onMultiSelect={savePendingWorkspaceSelection}
					/>
				</div>
			</DirectoryPickerModal>
		</div>
	);
}
