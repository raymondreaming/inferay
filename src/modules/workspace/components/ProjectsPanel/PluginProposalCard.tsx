import type { PluginReview, ProjectFileCommand } from "@contracts";
import { surfaceStyles } from "@design-system/styles.stylex.ts";
import { useBackgroundQuery } from "@shared/hooks/useQueryResource.tsx";
import { queryClient } from "@shared/lib/dom.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { CardInstructions } from "@shared/ui/ChatActionCard/index.tsx";
import { cardStyles } from "@shared/ui/ChatActionCard/styles.ts";
import * as stylex from "@stylexjs/stylex";
import { createSignal, Show } from "solid-js";
import {
	saveProjectCommand,
	selectProject,
	showProjectView,
} from "../../hooks/useProjects.tsx";
import {
	loadProjects,
	reviewProjectPlugin,
} from "../../services/projectsApi.ts";
import { PluginReviewDialog } from "./PluginReviewDialog.tsx";

type Bundle = Extract<ProjectFileCommand, { type: "createPlugin" }>;
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
	const saved = () => !!createdId() || !!existing();
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
					{props.command.slug}
				</strong>
			</div>
			<p {...stylex.attrs(cardStyles.status)}>
				{saved()
					? "Saved in project"
					: dismissed()
						? "Declined"
						: "Plugin proposal · Not saved"}
			</p>
			<div {...stylex.attrs(cardStyles.metadata)}>
				<span>
					{files().filter(([path]) => path.startsWith("automations/")).length}{" "}
					automations
				</span>
				<span>
					{files().filter(([path]) => path.startsWith("skills/")).length} skills
				</span>
				<span>
					{files().filter(([path]) => path.endsWith("/tool.json")).length} tools
				</span>
			</div>
			<details>
				<summary>Review files</summary>
				{files().map(([path, content]) => (
					<div>
						<strong>{path}</strong>
						<CardInstructions text={content} />
					</div>
				))}
			</details>
			{(error() || catalog.error) && (
				<p role="alert" {...stylex.attrs(cardStyles.feedback)}>
					{error() || String(catalog.error)}
				</p>
			)}
			<div {...stylex.attrs(cardStyles.footer)}>
				{!saved() && !dismissed() && (
					<>
						<Button
							size="sm"
							disabled={busy() || catalog.isPending || !!catalog.error}
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
							Save plugin
						</Button>
						<Button
							size="sm"
							variant="ghost"
							disabled={busy() || catalog.isPending || !!catalog.error}
							onClick={() => setDismissed(true)}
						>
							Decline
						</Button>
					</>
				)}
				{saved() && (
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
				{saved() && (
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
