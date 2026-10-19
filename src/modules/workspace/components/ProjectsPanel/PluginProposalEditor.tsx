import type { PluginProposalReview, ProjectFileCommand } from "@contracts";
import { project } from "@shared/lib/native.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { Modal } from "@shared/ui/Modal/index.tsx";
import { TextInput } from "@shared/ui/TextInput/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, For } from "solid-js";
import { useProjectAction } from "../../hooks/useProjects.tsx";
import { reviewPluginProposal } from "../../services/projectsApi.ts";
import { styles } from "./styles.ts";

type Bundle = Extract<
	ProjectFileCommand,
	{ type: "createPlugin" | "updatePlugin" }
>;

export function PluginProposalEditor(props: {
	command: Bundle;
	close: () => void;
	reviewed: (command: Bundle, review: PluginProposalReview) => void;
}) {
	const [files, setFiles] = createSignal({ ...props.command.files });
	const [remove, setRemove] = createSignal(
		props.command.type === "updatePlugin" ? [...props.command.remove] : [],
	);
	const [selected, setSelected] = createSignal(
		Object.keys(props.command.files)[0] ?? "",
	);
	const [path, setPath] = createSignal("");
	const dirty = () =>
		JSON.stringify(files()) !== JSON.stringify(props.command.files) ||
		JSON.stringify(remove()) !==
			JSON.stringify(
				props.command.type === "updatePlugin" ? props.command.remove : [],
			);
	const { busy, error, setError, run } = useProjectAction();
	function add(removal: boolean) {
		let value: string;
		try {
			value = project("proposalPath", {
				path: path(),
				removal,
			});
		} catch (error) {
			setError(String(error));
			return;
		}
		setError("");
		if (removal) {
			setRemove([...new Set([...remove(), value])]);
			const next = { ...files() };
			delete next[value];
			setFiles(next);
			if (selected() === value) setSelected("");
		} else {
			if (!(value in files())) setFiles({ ...files(), [value]: "" });
			setRemove(remove().filter((item) => item !== value));
			setSelected(value);
		}
		setPath("");
	}
	const review = () =>
		run(async () => {
			const command: Bundle =
				props.command.type === "updatePlugin"
					? { ...props.command, files: files(), remove: remove() }
					: { ...props.command, files: files() };
			props.reviewed(command, await reviewPluginProposal(command));
		});

	return (
		<Modal
			label="Edit plugin proposal"
			onClose={props.close}
			closeDisabled={busy() || dirty()}
			class={stylex.attrs(styles.dialog).class}
		>
			<div {...stylex.attrs(styles.formFields)}>
				<h3>Edit proposed files</h3>
				<p {...stylex.attrs(styles.muted)}>
					Changes stay in this draft until you review and save them.
				</p>
				<div {...stylex.attrs(styles.row)}>
					<For each={Object.keys(files())} keyed={(item) => item}>
						{(file) => (
							<Button
								size="sm"
								variant={selected() === file() ? "primary" : "ghost"}
								disabled={busy()}
								onClick={() => setSelected(file())}
							>
								{file()}
							</Button>
						)}
					</For>
				</div>
				{selected() && selected() in files() && (
					<>
						<textarea
							aria-label={`Edit ${selected()}`}
							spellcheck={false}
							value={files()[selected()]}
							disabled={busy()}
							onInput={(event) =>
								setFiles({
									...files(),
									[selected()]: event.currentTarget.value,
								})
							}
							{...stylex.attrs(styles.code)}
						/>
						{selected() !== "plugin.json" && (
							<Button
								size="sm"
								variant="ghost"
								disabled={busy()}
								onClick={() => {
									const next = { ...files() };
									delete next[selected()];
									setFiles(next);
									setSelected(Object.keys(next)[0] ?? "");
								}}
							>
								Omit this proposed file change
							</Button>
						)}
					</>
				)}
				<For each={remove()} keyed={(item) => item}>
					{(file) => (
						<div {...stylex.attrs(styles.row)}>
							<span {...stylex.attrs(styles.muted)}>Remove {file()}</span>
							<Button
								size="sm"
								variant="ghost"
								disabled={busy()}
								onClick={() =>
									setRemove(remove().filter((item) => item !== file()))
								}
							>
								Keep file
							</Button>
						</div>
					)}
				</For>
				<div {...stylex.attrs(styles.row)}>
					<TextInput
						aria-label="File path within library"
						placeholder="scripts/render.py"
						value={path()}
						disabled={busy()}
						onInput={(event) => setPath(event.currentTarget.value)}
					/>
					<Button
						size="sm"
						disabled={busy() || !path().trim()}
						onClick={() => add(false)}
					>
						Add file change
					</Button>
					{props.command.type === "updatePlugin" && (
						<Button
							size="sm"
							variant="ghost"
							disabled={busy() || !path().trim()}
							onClick={() => add(true)}
						>
							Remove existing file
						</Button>
					)}
				</div>
				{error() && <p role="alert">{error()}</p>}
				<div {...stylex.attrs(styles.row)}>
					<Button size="sm" disabled={busy()} onClick={props.close}>
						{dirty() ? "Discard edits" : "Cancel"}
					</Button>
					<Button
						size="sm"
						variant="primary"
						disabled={busy()}
						onClick={() => void review()}
					>
						{busy() ? "Validating…" : "Review changes"}
					</Button>
				</div>
			</div>
		</Modal>
	);
}
