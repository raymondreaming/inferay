import type { ProjectEffectIntent } from "@contracts";
import { useBackgroundQuery } from "@shared/hooks/useQueryResource.tsx";
import { queryClient } from "@shared/lib/dom.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, For, Show } from "solid-js";
import { refreshProjects } from "../../hooks/useProjects.tsx";
import { loadEffectInbox } from "../../services/projectsApi.ts";
import { EffectIntentDialog } from "./EffectIntentDialog.tsx";
import { styles } from "./styles.ts";

export function EffectInbox(props: {
	projectId: string;
	automationId?: string;
}) {
	const [cursor, setCursor] = createSignal<{
		scope: string;
		before: string;
	} | null>(null);
	const [reviewing, setReviewing] = createSignal<ProjectEffectIntent | null>(
		null,
	);
	const scope = () => JSON.stringify([props.projectId, props.automationId]);
	const before = () =>
		cursor()?.scope === scope() ? cursor()?.before : undefined;
	const inbox = useBackgroundQuery(() => ({
		queryKey: [
			"effect-inbox",
			props.projectId,
			props.automationId ?? "",
			before() ?? "",
		],
		queryFn: () =>
			loadEffectInbox(props.projectId, props.automationId, before()),
		refetchInterval: 5000,
	}));
	return (
		<>
			<Show when={reviewing()} keyed>
				{(effect) => (
					<EffectIntentDialog
						effect={effect}
						close={() => setReviewing(null)}
						changed={async () => {
							await queryClient.invalidateQueries({
								queryKey: ["effect-inbox", props.projectId],
							});
							await refreshProjects();
						}}
					/>
				)}
			</Show>
			<Show when={inbox.error}>
				<p role="alert">Unable to load pending reviews.</p>
			</Show>
			<Show when={(inbox.data?.effects.length ?? 0) > 0 || before()}>
				<section
					aria-label="Pending reviews"
					{...stylex.attrs(styles.historyUpcoming)}
				>
					<strong {...stylex.attrs(styles.sectionLabel)}>Needs review</strong>
					<For each={inbox.data?.effects ?? []} keyed={(effect) => effect.id}>
						{(effect) => (
							<div {...stylex.attrs(styles.row)}>
								<Button
									size="sm"
									variant="ghost"
									onClick={() => setReviewing(effect())}
								>
									{effect().intent.kind} · {effect().intent.target}
								</Button>
								<span {...stylex.attrs(styles.muted)}>Not sent</span>
							</div>
						)}
					</For>
					<Show when={before()}>
						<Button size="sm" variant="ghost" onClick={() => setCursor(null)}>
							Latest reviews
						</Button>
					</Show>
					<Show when={inbox.data?.nextCursor}>
						<Button
							size="sm"
							variant="ghost"
							onClick={() =>
								setCursor({ scope: scope(), before: inbox.data!.nextCursor! })
							}
						>
							Older reviews
						</Button>
					</Show>
				</section>
			</Show>
		</>
	);
}
