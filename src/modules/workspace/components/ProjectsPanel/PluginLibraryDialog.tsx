import type { PluginReview, PluginTextFile } from "@contracts";
import { Markdown } from "@conversation/components/ChatRichContent/Markdown.tsx";
import { useBackgroundQuery } from "@shared/hooks/useQueryResource.tsx";
import { queryClient } from "@shared/lib/dom.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { Modal } from "@shared/ui/Modal/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, Show } from "solid-js";
import { saveProjectCommand } from "../../hooks/useProjects.tsx";
import { type ProjectPlugin, pluginName } from "../../model/projectFiles.ts";
import {
	readPluginLibrary,
	readPluginTextFile,
	reviewProjectPlugin,
} from "../../services/projectsApi.ts";
import { PluginReviewDialog } from "./PluginReviewDialog.tsx";
import { styles } from "./styles.ts";

export function PluginLibraryDialog(props: {
	plugin: ProjectPlugin;
	close: () => void;
}) {
	const [editing, setEditing] = createSignal<PluginTextFile | null>(null);
	const [draft, setDraft] = createSignal("");
	const [saving, setSaving] = createSignal(false);
	const [saved, setSaved] = createSignal(false);
	const dirty = () => editing() !== null && draft() !== editing()?.content;
	async function saveFile() {
		const file = editing();
		if (!file || saving()) return;
		setSaving(true);
		setError("");
		try {
			await saveProjectCommand({
				type: "saveDefinition",
				projectId: props.plugin.file.projectId,
				path:
					props.plugin.file.sourcePath.replace(/plugin\.json$/, "") + file.path,
				content: draft(),
				expectedHash: file.sourceHash,
			});
			setEditing(null);
			setSaved(true);
			await library.refetch();
			await content.refetch();
		} catch (error) {
			setError(String(error));
		} finally {
			setSaving(false);
		}
	}
	const [selected, setSelected] = createSignal<string | null>(null);
	const [review, setReview] = createSignal<PluginReview | null>(null);
	const [reviewing, setReviewing] = createSignal(false);
	const [error, setError] = createSignal("");
	const library = useBackgroundQuery(
		() => ({
			queryKey: ["plugin-library", props.plugin.file.id],
			queryFn: () => readPluginLibrary(props.plugin.file.id),
		}),
		() => queryClient,
	);
	const path = () =>
		selected() ??
		(props.plugin.file.error ? "plugin.json" : undefined) ??
		library.data?.files.find((file) => /^readme\.md$/i.test(file.path))?.path;
	const content = useBackgroundQuery(
		() => ({
			queryKey: [
				"plugin-library-file",
				props.plugin.file.id,
				path(),
				library.data?.files.find((file) => file.path === path())?.sourceHash,
			],
			enabled: !!path(),
			queryFn: () => readPluginTextFile(props.plugin.file.id, path()!),
		}),
		() => queryClient,
	);
	async function openReview() {
		setReviewing(true);
		setError("");
		try {
			setReview(await reviewProjectPlugin(props.plugin.file.id));
		} catch (error) {
			setError(String(error));
		} finally {
			setReviewing(false);
		}
	}
	return (
		<Show
			when={review()}
			fallback={
				<Modal
					label={pluginName(props.plugin)}
					onClose={props.close}
					closeDisabled={dirty() || saving()}
					class={stylex.attrs(styles.dialog).class}
				>
					<div {...stylex.attrs(styles.formFields)}>
						<h3>{pluginName(props.plugin)}</h3>
						<p {...stylex.attrs(styles.muted)}>
							{props.plugin.file.definition?.description}
						</p>
						{props.plugin.file.error && (
							<p role="alert">{props.plugin.file.error}</p>
						)}
						{library.error && <p role="alert">{String(library.error)}</p>}
						{library.isPending && <p role="status">Loading library…</p>}
						<div {...stylex.attrs(styles.row)}>
							<Button
								size="sm"
								disabled={
									reviewing() || !!editing() || !!props.plugin.file.error
								}
								onClick={() => void openReview()}
							>
								{reviewing()
									? "Checking inputs…"
									: "Review changes & permissions"}
							</Button>
						</div>
						{error() && <p role="alert">{error()}</p>}
						<div {...stylex.attrs(styles.list)}>
							{(
								[
									"Skills",
									"Tools",
									"Automations",
									"Code, documentation & assets",
								] as const
							).map((label, index) => {
								const groups = ["skills/", "tools/", "automations/"];
								const files = () =>
									(library.data?.files ?? []).filter((file) =>
										index < 3
											? file.path.startsWith(groups[index])
											: !groups.some((prefix) => file.path.startsWith(prefix)),
									);
								return (
									<Show when={files().length > 0}>
										<div>
											<strong>{label}</strong>
											<div {...stylex.attrs(styles.row)}>
												{files().map((file) => (
													<Button
														size="sm"
														variant={path() === file.path ? "primary" : "ghost"}
														disabled={!!editing()}
														onClick={() => {
															setSelected(file.path);
															setSaved(false);
															setError("");
														}}
													>
														{file.path}
													</Button>
												))}
											</div>
										</div>
									</Show>
								);
							})}
						</div>
						{path() && <strong>{path()}</strong>}
						{path() && content.isPending && <p role="status">Loading file…</p>}
						{content.error && <p role="alert">{String(content.error)}</p>}
						{!editing() &&
							content.data &&
							(/\.md$/i.test(content.data.path) ? (
								<Markdown text={content.data.content} />
							) : (
								<pre {...stylex.attrs(styles.pre)}>{content.data.content}</pre>
							))}
						{content.data && !editing() && (
							<Button
								size="sm"
								onClick={() => {
									const file = content.data;
									if (!file) return;
									setEditing(file);
									setDraft(file.content);
									setSaved(false);
									setError("");
								}}
							>
								Edit file
							</Button>
						)}
						{editing() && (
							<>
								<textarea
									aria-label={`Edit ${editing()?.path}`}
									value={draft()}
									disabled={saving()}
									onInput={(event) => setDraft(event.currentTarget.value)}
									{...stylex.attrs(styles.code)}
								/>
								<div {...stylex.attrs(styles.row)}>
									<Button
										size="sm"
										disabled={saving()}
										onClick={() => {
											setEditing(null);
											setError("");
										}}
									>
										Discard edits
									</Button>
									<Button
										size="sm"
										variant="primary"
										disabled={saving() || !dirty()}
										onClick={() => void saveFile()}
									>
										{saving() ? "Saving…" : "Save file"}
									</Button>
								</div>
								<p {...stylex.attrs(styles.muted)}>
									Save or discard edits before changing files. Changed inputs
									require a new approval before their schedules can run.
								</p>
							</>
						)}
						{saved() && (
							<p role="status">
								File saved. Review changed inputs before enabling schedules.
							</p>
						)}
						{!path() && !library.isPending && (
							<p {...stylex.attrs(styles.muted)}>
								Select a file to inspect it. Add a README to explain when and
								how to use this library.
							</p>
						)}
					</div>
				</Modal>
			}
			keyed
		>
			{(value) => (
				<PluginReviewDialog review={value} close={() => setReview(null)} />
			)}
		</Show>
	);
}
