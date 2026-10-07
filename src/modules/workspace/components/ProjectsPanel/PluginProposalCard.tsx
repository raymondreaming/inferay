import type {
	PluginDefinition,
	PluginReview,
	ProjectFileCommand,
} from "@contracts";
import { surfaceStyles } from "@design-system/styles.stylex.ts";
import { useBackgroundQuery } from "@shared/hooks/useQueryResource.tsx";
import { queryClient } from "@shared/lib/dom.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { CardInstructions } from "@shared/ui/ChatActionCard/index.tsx";
import { cardStyles } from "@shared/ui/ChatActionCard/styles.ts";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, Show } from "solid-js";
import {
	saveProjectCommand,
	selectProject,
	showProjectView,
} from "../../hooks/useProjects.tsx";
import {
	loadProjects,
	readPluginLibrary,
	reviewProjectPlugin,
} from "../../services/projectsApi.ts";
import { PluginReviewDialog } from "./PluginReviewDialog.tsx";

type Bundle = Extract<
	ProjectFileCommand,
	{ type: "createPlugin" | "updatePlugin" }
>;
export function PluginProposalCard(props: { command: Bundle }) {
	const [createdId, setCreatedId] = createSignal<string | null>(null);
	const [review, setReview] = createSignal<PluginReview | null>(null);
	const catalog = useBackgroundQuery(
		() => ({
			queryKey: ["plugin-proposal-project", props.command.projectId],
			queryFn: () => loadProjects(props.command.projectId),
		}),
		() => queryClient,
	);
	const existing = () =>
		catalog.data?.plugins.find(
			(plugin) =>
				plugin.file.sourcePath === `plugins/${props.command.slug}/plugin.json`,
		);
	const manifest = createMemo(() => {
		const content = props.command.files["plugin.json"];
		if (!content) return existing();
		try {
			return JSON.parse(content) as PluginDefinition;
		} catch {
			return undefined;
		}
	});
	const library = useBackgroundQuery(
		() => ({
			queryKey: ["plugin-proposal-library", existing()?.id ?? ""],
			queryFn: () => readPluginLibrary(existing()!.id),
			enabled: props.command.type === "updatePlugin" && !!existing(),
		}),
		() => queryClient,
	);
	const saved = () => !!createdId();
	const changed = () =>
		props.command.type === "updatePlugin"
			? !existing() ||
				(!!library.data &&
					library.data.sourceHash !== props.command.expectedHash)
			: !!existing();
	const unavailable = () =>
		catalog.isPending ||
		!!catalog.error ||
		(props.command.type === "updatePlugin" &&
			(library.isPending || !!library.error));
	const removals = () =>
		props.command.type === "updatePlugin" ? props.command.remove : [];
	const [dismissed, setDismissed] = createSignal(false);
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal("");
	const files = () => Object.entries(props.command.files);
	return (
		<section
			aria-label="Plugin proposal"
			{...stylex.attrs(surfaceStyles.panel, cardStyles.card)}
		>
			<div {...stylex.attrs(cardStyles.header)}>
				<strong {...stylex.attrs(cardStyles.title)}>
					{manifest()?.name ?? props.command.slug}
				</strong>
			</div>
			<p {...stylex.attrs(cardStyles.status)}>
				{saved()
					? "Saved in project"
					: dismissed()
						? "Declined"
						: changed()
							? "Library changed · Review the current files"
							: props.command.type === "updatePlugin"
								? "Library update · Not saved"
								: "Plugin proposal · Not saved"}
			</p>
			<div {...stylex.attrs(cardStyles.metadata)}>
				<span>
					{files().length}{" "}
					{props.command.type === "updatePlugin"
						? "files to add or replace"
						: "files"}
				</span>
				{removals().length > 0 && (
					<span>{removals().length} files to remove</span>
				)}
			</div>
			<details>
				<summary>Review proposed files</summary>
				{removals().map((path) => (
					<p>Remove {path}</p>
				))}
				{files().map(([path, content]) => (
					<div>
						<strong>{path}</strong>
						<CardInstructions text={content} />
					</div>
				))}
			</details>
			{(error() || catalog.error || library.error) && (
				<p role="alert" {...stylex.attrs(cardStyles.feedback)}>
					{error() || String(catalog.error || library.error)}
				</p>
			)}
			<div {...stylex.attrs(cardStyles.footer)}>
				{!saved() && !dismissed() && !changed() && (
					<>
						<Button
							size="sm"
							disabled={busy() || unavailable()}
							onClick={async () => {
								setBusy(true);
								setError("");
								try {
									const result = await saveProjectCommand(props.command);
									if (!result.id)
										throw new Error("Plugin save returned no identity");
									setCreatedId(result.id);
									await catalog.refetch();
									setReview(await reviewProjectPlugin(result.id));
								} catch (error) {
									setError(String(error));
								} finally {
									setBusy(false);
								}
							}}
						>
							{props.command.type === "updatePlugin"
								? "Save changes"
								: "Save plugin"}
						</Button>
						<Button
							size="sm"
							variant="ghost"
							disabled={busy() || unavailable()}
							onClick={() => setDismissed(true)}
						>
							Decline
						</Button>
					</>
				)}
				{(saved() || existing()) && (
					<Button
						size="sm"
						disabled={busy()}
						onClick={async () => {
							const id = createdId() ?? existing()?.id;
							if (!id) return;
							setBusy(true);
							setError("");
							try {
								setReview(await reviewProjectPlugin(id));
							} catch (error) {
								setError(String(error));
							} finally {
								setBusy(false);
							}
						}}
					>
						Review & approve
					</Button>
				)}
				{(saved() || existing()) && (
					<Button
						size="sm"
						onClick={async () => {
							await selectProject(props.command.projectId);
							showProjectView("plugins");
						}}
					>
						Open plugin
					</Button>
				)}
			</div>
			<Show when={review()} keyed>
				{(value) => (
					<PluginReviewDialog
						review={value}
						close={() => {
							setReview(null);
							void catalog.refetch();
						}}
					/>
				)}
			</Show>
		</section>
	);
}
