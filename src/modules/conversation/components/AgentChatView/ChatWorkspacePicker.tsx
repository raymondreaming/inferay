import * as stylex from "@stylexjs/stylex";
import { InlineDirectoryPicker } from "../../../workspace/components/InlineDirectoryPicker/index.tsx";
import { DirectoryPickerModal } from "./DirectoryPickerModal.tsx";
import { styles } from "./styles.ts";
export function ChatWorkspacePicker(_props: {
	savePendingWorkspaceSelection: (paths: string[]) => void;
	onDirectoryCancel: ((paneId: string) => void) | undefined;
	paneId: string;
}) {
	return (
		<div {...stylex.attrs(styles.directoryPickerWrap)}>
			<DirectoryPickerModal>
				<div {...stylex.attrs(styles.directoryPickerInner)}>
					<InlineDirectoryPicker
						onSelect={(path) => {
							if (path) _props.savePendingWorkspaceSelection([path]);
							else {
								_props.savePendingWorkspaceSelection([]);
								_props.onDirectoryCancel?.(_props.paneId);
							}
						}}
						onCancel={() => {
							_props.savePendingWorkspaceSelection([]);
							_props.onDirectoryCancel?.(_props.paneId);
						}}
						multiSelect
						showStartButton={false}
						onSelectionChange={(paths) => {
							_props.savePendingWorkspaceSelection(paths);
						}}
						onMultiSelect={_props.savePendingWorkspaceSelection}
					/>
				</div>
			</DirectoryPickerModal>
		</div>
	);
}
