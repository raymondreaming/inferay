import type {
	PluginDefinition,
	PluginProposalReview,
	PluginReview,
	ProjectFileCommand,
} from "@contracts";
import { surfaceStyles } from "@design-system/styles.stylex.ts";
import { useBackgroundQuery } from "@shared/hooks/useQueryResource.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { cardStyles } from "@shared/ui/ChatActionCard/styles.ts";
import { Modal } from "@shared/ui/Modal/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, Show } from "solid-js";
import { useProjectProposal } from "../../hooks/useProjectProposal.tsx";
import {
	selectProject,
	showProjectView,
	useProjectAction,
} from "../../hooks/useProjects.tsx";
import {
	loadProjects,
	readPluginLibrary,
	reviewPluginProposal,
	reviewProjectPlugin,
} from "../../services/projectsApi.ts";
import { DefinitionChanges } from "./DefinitionChanges.tsx";
import { PluginProposalEditor } from "./PluginProposalEditor.tsx";
import { PluginReviewDialog } from "./PluginReviewDialog.tsx";
import { styles } from "./styles.ts";

type Bundle = Extract<
	ProjectFileCommand,
	{ type: "createPlugin" | "updatePlugin" }
>;
export function PluginProposalCard(props: {
	command: Bundle;
	messageId: string;
	onResult?: (message: string) => void;
}) {
	const proposal = useProjectProposal(() => ({
		messageId: props.messageId,
		command: props.command,
	}));
	const [draft, setDraft] = createSignal<Bundle | null>(null);
	const [editing, setEditing] = createSignal(false);
	const candidate = () => draft() ?? props.command;
	const createdId = () => proposal.view()?.entityId;

	const [review, setReview] = createSignal<PluginReview | null>(null);
	const catalog = useBackgroundQuery(() => ({
		queryKey: ["plugin-proposal-project", props.command.projectId],
		queryFn: () => loadProjects(props.command.projectId),
	}));
	const existing = () =>
		catalog.data?.plugins.find(
			(plugin) =>
				plugin.file.sourcePath === `plugins/${props.command.slug}/plugin.json`,
		);
	const manifest = createMemo(() => {
		if (proposal.view()?.status === "saved" && existing()?.file.definition)
			return existing()?.file.definition;
		const content = candidate().files["plugin.json"];
		if (!content) return existing()?.file.definition;
		try {
			return JSON.parse(content) as PluginDefinition;
		} catch {
			return undefined;
		}
	});
	const library = useBackgroundQuery(() => ({
		queryKey: ["plugin-proposal-library", existing()?.file.id ?? ""],
		queryFn: () => readPluginLibrary(existing()!.file.id),
		enabled: props.command.type === "updatePlugin" && !!existing(),
	}));
	const saved = () => proposal.view()?.status === "saved";
	const changed = () =>
		props.command.type === "updatePlugin"
			? !existing() ||
				(!!library.data &&
					library.data.sourceHash !== props.command.expectedHash)
			: !!existing();
	const unavailable = () =>
		proposal.loading() ||
		proposal.busy() ||
		catalog.isPending ||
		!!catalog.error ||
		(props.command.type === "updatePlugin" &&
			(library.isPending || !!library.error));
	const removals = () => {
		const value = candidate();
		return value.type === "updatePlugin" ? value.remove : [];
	};
	const dismissed = () => proposal.view()?.status === "declined";
	const { busy, error, run } = useProjectAction();
	const files = () => Object.entries(candidate().files);
	const [comparison, setComparison] = createSignal<PluginProposalReview | null>(
		null,
	);
	const compare = () =>
		run(async () => {
			setComparison(await reviewPluginProposal(candidate()));
		});
	const save = () =>
		run(async () => {
			const result = await proposal.decide("save", draft() ?? undefined);
			if (result?.status !== "saved" || !result.entityId) return;
			setComparison(null);
			props.onResult?.(
				"Saved the plugin “" +
					(manifest()?.name ?? props.command.slug) +
					"”. Execution approval is separate.",
			);
			await catalog.refetch();
			setReview(await reviewProjectPlugin(result.entityId));
		});

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
			{!saved() && !dismissed() && (
				<Button
					size="sm"
					variant="ghost"
					disabled={busy()}
					onClick={() => void compare()}
				>
					{busy() ? "Preparing comparison…" : "Review changes"}
				</Button>
			)}
			{!saved() && !dismissed() && (
				<Button
					size="sm"
					variant="ghost"
					disabled={busy() || unavailable() || changed()}
					onClick={() => setEditing(true)}
				>
					Edit proposal
				</Button>
			)}
			<Show when={editing()}>
				<PluginProposalEditor
					command={candidate()}
					close={() => setEditing(false)}
					reviewed={(command, value) => {
						setDraft(command);
						setEditing(false);
						setComparison(value);
					}}
				/>
			</Show>
			<Show when={comparison()} keyed>
				{(value) => (
					<Modal
						label={`Review ${value.name}`}
						onClose={() => setComparison(null)}
						closeDisabled={busy()}
						class={stylex.attrs(styles.dialog).class}
					>
						<div {...stylex.attrs(styles.formFields)}>
							<h3>{value.name}</h3>
							{draft() && (
								<p {...stylex.attrs(styles.muted)}>Includes your edits</p>
							)}
							<div {...stylex.attrs(styles.row)}>
								<span>
									Current permissions:{" "}
									{value.previousPermissions.join(", ") || "None declared"}
								</span>
								<span>
									Proposed permissions:{" "}
									{value.permissions.join(", ") || "None declared"}
								</span>
							</div>
							<DefinitionChanges
								files={value.files}
								beforeLabel="Current"
								afterLabel="Proposed"
							/>
							{(error() || proposal.error()) && (
								<p role="alert">{error() || proposal.error()}</p>
							)}
							<div {...stylex.attrs(styles.row)}>
								<Button
									size="sm"
									disabled={busy()}
									onClick={() => setComparison(null)}
								>
									Close
								</Button>
								<Button
									size="sm"
									variant="primary"
									disabled={busy() || unavailable() || changed()}
									onClick={() => void save()}
								>
									Save proposed files
								</Button>
							</div>
						</div>
					</Modal>
				)}
			</Show>
			{(error() || proposal.error() || catalog.error || library.error) && (
				<p role="alert" {...stylex.attrs(cardStyles.feedback)}>
					{error() ||
						proposal.error() ||
						String(catalog.error || library.error)}
				</p>
			)}
			<div {...stylex.attrs(cardStyles.footer)}>
				{!saved() && !dismissed() && (
					<>
						<Button
							size="sm"
							disabled={busy() || unavailable() || changed()}
							onClick={() => void save()}
						>
							{props.command.type === "updatePlugin"
								? "Save changes"
								: "Save plugin"}
						</Button>
						<Button
							size="sm"
							variant="ghost"
							disabled={busy() || proposal.loading() || proposal.busy()}
							onClick={async () => {
								const result = await proposal.decide("decline");
								if (result?.status === "declined")
									props.onResult?.(
										"Declined the plugin proposal for “" +
											(manifest()?.name ?? props.command.slug) +
											"”. Do not apply it.",
									);
							}}
						>
							Decline
						</Button>
					</>
				)}
				{(saved() || existing()) && (
					<Button
						size="sm"
						disabled={busy()}
						onClick={() =>
							void run(async () => {
								const id = createdId() ?? existing()?.file.id;
								if (id) setReview(await reviewProjectPlugin(id));
							})
						}
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
