import type { PluginReview } from "@contracts";
import { Button } from "@shared/ui/Button/index.tsx";
import { Modal } from "@shared/ui/Modal/index.tsx";
import { SettingsRow } from "@shared/ui/SettingsSurface/index.tsx";
import { Switch } from "@shared/ui/Switch/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, For } from "solid-js";
import { saveProjectCommand } from "../../hooks/useProjects.tsx";
import { automationScheduleLabel } from "../../model/automationSchedule.ts";
import { DefinitionChanges } from "./DefinitionChanges.tsx";
import { GitWriteAccess } from "./GitWriteAccess.tsx";
import { styles } from "./styles.ts";

export function PluginReviewDialog(props: {
	review: PluginReview;
	close: () => void;
}) {
	const [enable, setEnable] = createSignal(false);
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal("");
	async function approve() {
		setBusy(true);
		setError("");
		try {
			await saveProjectCommand({
				type: "approvePlugin",
				id: props.review.id,
				expectedInputsHash: props.review.inputsHash,
				enable: enable(),
			});
			props.close();
		} catch (error) {
			setError(String(error));
		} finally {
			setBusy(false);
		}
	}
	return (
		<Modal
			label={`Review ${props.review.name}`}
			closeDisabled={busy()}
			onClose={props.close}
			class={stylex.attrs(styles.dialog).class}
		>
			<div {...stylex.attrs(styles.form)}>
				<h3>{props.review.name}</h3>
				<p {...stylex.attrs(styles.muted)}>
					Permissions: {props.review.permissions.join(", ") || "None declared"}
				</p>
				<p {...stylex.attrs(styles.muted)}>
					Automation runs apply filesystem and network limits. Git actions and
					read access are not yet fully isolated.
				</p>
				<For each={props.review.automations} keyed={(item) => item.id}>
					{(automation) => (
						<div {...stylex.attrs(styles.row)}>
							<strong>{automation().name}</strong>
							<span {...stylex.attrs(styles.muted)}>
								{automationScheduleLabel(automation())}
							</span>
						</div>
					)}
				</For>
				<GitWriteAccess paths={props.review.gitWritePaths ?? []} />
				<DefinitionChanges
					files={props.review.files}
					beforeLabel="Previously approved"
					afterLabel="Current"
				/>
				{props.review.automations.some(
					(automation) => automation.trigger.kind !== "manual",
				) && (
					<SettingsRow
						label="Enable schedules"
						description="Start scheduled runs after approval"
					>
						<Switch
							label="Enable schedules after approval"
							checked={enable()}
							onChange={setEnable}
							disabled={busy()}
						/>
					</SettingsRow>
				)}
				{error() && <p role="alert">{error()}</p>}
				<div {...stylex.attrs(styles.row)}>
					<Button size="sm" disabled={busy()} onClick={props.close}>
						Cancel
					</Button>
					<Button
						size="sm"
						variant="primary"
						disabled={busy()}
						onClick={() => void approve()}
					>
						{enable() ? "Approve & enable" : "Approve"}
					</Button>
				</div>
			</div>
		</Modal>
	);
}
