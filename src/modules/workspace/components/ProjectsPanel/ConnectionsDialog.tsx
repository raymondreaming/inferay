import type { ConnectionInfo } from "@contracts";
import { useBackgroundQuery } from "@shared/hooks/useQueryResource.tsx";
import { queryClient } from "@shared/lib/dom.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { Modal } from "@shared/ui/Modal/index.tsx";
import { TextInput } from "@shared/ui/TextInput/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, For } from "solid-js";
import {
	changeProjectConnection,
	loadProjectConnections,
} from "../../services/projectsApi.ts";
import { styles } from "./styles.ts";

export function ConnectionsDialog(props: {
	projectId: string;
	close: () => void;
}) {
	const [editing, setEditing] = createSignal<ConnectionInfo | null>(null);
	const [name, setName] = createSignal("");
	const [secret, setSecret] = createSignal("");
	const [pending, setPending] = createSignal(false);
	const [error, setError] = createSignal("");
	const [removing, setRemoving] = createSignal<string | null>(null);
	const connections = useBackgroundQuery(
		() => ({
			queryKey: ["project-connections", props.projectId],
			queryFn: () => loadProjectConnections(props.projectId),
		}),
		() => queryClient,
	);
	const clear = () => {
		setEditing(null);
		setName("");
		setSecret("");
	};
	async function save() {
		if (pending()) return;
		setPending(true);
		setError("");
		try {
			await changeProjectConnection({
				action: "save",
				projectId: props.projectId,
				id: editing()?.id ?? null,
				expectedRevision: editing()?.revision ?? null,
				name: name(),
				secret: secret(),
			});
			clear();
			await queryClient.invalidateQueries({
				queryKey: ["project-connections", props.projectId],
			});
		} catch (error) {
			setError(String(error));
		} finally {
			setPending(false);
		}
	}
	async function remove(connection: ConnectionInfo) {
		setPending(true);
		setError("");
		try {
			await changeProjectConnection({
				action: "delete",
				projectId: props.projectId,
				id: connection.id,
				expectedRevision: connection.revision,
			});
			setRemoving(null);
			if (editing()?.id === connection.id) clear();
			await queryClient.invalidateQueries({
				queryKey: ["project-connections", props.projectId],
			});
		} catch (error) {
			setError(String(error));
		} finally {
			setPending(false);
		}
	}
	return (
		<Modal
			label="Project connections"
			onClose={props.close}
			closeDisabled={pending()}
			class={stylex.attrs(styles.dialog).class}
		>
			<div {...stylex.attrs(styles.form)}>
				<strong>Project connections</strong>
				<p {...stylex.attrs(styles.muted)}>
					Keys are stored in macOS Keychain for this project. Saved keys are
					never shown again. Connecting these keys to tools is not available
					yet.
				</p>
				{(error() || connections.error) && (
					<p role="alert">{error() || String(connections.error)}</p>
				)}
				{connections.isPending && <p role="status">Loading connections…</p>}
				<For each={connections.data?.connections ?? []}>
					{(connection) => (
						<div {...stylex.attrs(styles.row)}>
							<strong>{connection.name}</strong>
							<Button
								size="sm"
								variant="ghost"
								disabled={pending()}
								onClick={() => {
									setEditing(connection);
									setName(connection.name);
									setSecret("");
								}}
							>
								Replace key
							</Button>
							{removing() === connection.id ? (
								<>
									<Button
										size="sm"
										disabled={pending()}
										onClick={() => void remove(connection)}
									>
										Confirm removal
									</Button>
									<Button
										size="sm"
										variant="ghost"
										disabled={pending()}
										onClick={() => setRemoving(null)}
									>
										Cancel
									</Button>
								</>
							) : (
								<Button
									size="sm"
									variant="ghost"
									disabled={pending()}
									onClick={() => setRemoving(connection.id)}
								>
									Remove
								</Button>
							)}
						</div>
					)}
				</For>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void save();
					}}
					{...stylex.attrs(styles.formFields)}
				>
					<label>
						Name
						<TextInput
							fullWidth
							required
							maxlength={100}
							value={name()}
							disabled={pending()}
							onInput={(event) => setName(event.currentTarget.value)}
						/>
					</label>
					<label>
						{editing() ? "New key" : "API key"}
						<TextInput
							fullWidth
							required
							type="password"
							autocomplete="new-password"
							spellcheck={false}
							maxlength={8192}
							value={secret()}
							disabled={pending()}
							onInput={(event) => setSecret(event.currentTarget.value)}
						/>
					</label>
					<div {...stylex.attrs(styles.row)}>
						<Button
							type="submit"
							disabled={pending() || !name().trim() || !secret()}
						>
							{pending() ? "Saving…" : editing() ? "Replace key" : "Save key"}
						</Button>
						{editing() && (
							<Button
								type="button"
								variant="ghost"
								disabled={pending()}
								onClick={clear}
							>
								Cancel replacement
							</Button>
						)}
					</div>
				</form>
			</div>
		</Modal>
	);
}
