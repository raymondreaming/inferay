import type { SkillProposal, SkillProposalView } from "@contracts";
import { surfaceStyles } from "@design-system/styles.stylex.ts";
import { useQueryResource } from "@shared/hooks/useQueryResource.tsx";
import { ariaValue, openSkills } from "@shared/lib/dom.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { CardInstructions } from "@shared/ui/ChatActionCard/index.tsx";
import { cardStyles as styles } from "@shared/ui/ChatActionCard/styles.ts";
import {
	decideSkillProposal,
	previewSkillProposal,
} from "@skills/services/skillsApi.ts";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal } from "solid-js";

export { SkillReadCard } from "./SkillReadCard.tsx";

export function SkillProposalCard(_props: {
	proposal: SkillProposal;
	messageId: string;
	streaming?: boolean;
	onResult?: (text: string) => void;
}) {
	const request = createMemo(() => ({
		messageId: _props.messageId,
		proposal: JSON.parse(JSON.stringify(_props.proposal)) as SkillProposal,
	}));
	const resource = useQueryResource<SkillProposalView | null>(
		() => {
			const input = request();
			return (signal) => previewSkillProposal(input, signal);
		},
		() => null,
		() => ({
			queryKey: ["skills", "proposal", request().messageId, request().proposal],
			enabled: !_props.streaming,
		}),
	);
	const view = createMemo(() => resource.data);
	const loading = createMemo(() => !resource.loaded || resource.loading);
	const inFlight = {
		current: false,
	};
	const [saving, setSaving] = createSignal(false);
	const [error, setError] = createSignal("");
	const decide = async (decision: "approve" | "reject") => {
		const _viewValue = view();
		if (
			inFlight.current ||
			_props.streaming ||
			loading() ||
			_viewValue?.decided ||
			(decision === "approve" && _viewValue?.blockedReason)
		)
			return;
		inFlight.current = true;
		setSaving(true);
		setError("");
		try {
			const result = await decideSkillProposal(
				_props.messageId,
				_props.proposal,
				decision,
			);
			resource.setData(result);
			if (result.message) _props.onResult?.(result.message);
		} catch (error) {
			setError(
				error instanceof Error
					? error.message
					: "Could not save skill. Nothing was approved as saved.",
			);
		} finally {
			inFlight.current = false;
			setSaving(false);
		}
	};
	return (
		<section
			aria-label={ariaValue(`Skill proposal: ${_props.proposal.name}`)}
			{...stylex.attrs(surfaceStyles.panel, styles.card)}
		>
			<div {...stylex.attrs(styles.header)}>
				<div {...stylex.attrs(styles.heading)}>
					<div {...stylex.attrs(styles.title)}>{_props.proposal.name}</div>
					<p {...stylex.attrs(styles.status)}>
						{view()?.title ?? "Global skill proposal"} · /
						{_props.proposal.command}
					</p>
				</div>
			</div>
			<div {...stylex.attrs(styles.metadata)}>
				{_props.proposal.description}
			</div>
			<CardInstructions
				text={_props.proposal.promptTemplate}
				label="Proposed instructions"
			/>
			{view()?.currentInstructions != null && (
				<CardInstructions
					text={view()!.currentInstructions!}
					label="Current instructions"
				/>
			)}

			{view()?.blockedReason && <p role="alert">{view()?.blockedReason}</p>}
			{(error() || resource.error) && (
				<p role="alert">{error() || resource.error}</p>
			)}
			<div role="status" {...stylex.attrs(styles.feedback)}>
				{saving()
					? "Saving decision…"
					: (view()?.status ?? "Loading proposal…")}
			</div>

			<div {...stylex.attrs(styles.footer)}>
				{!view()?.decided && (
					<>
						<Button
							size="sm"
							type="button"
							disabled={
								saving() ||
								_props.streaming ||
								loading() ||
								!!view()?.blockedReason
							}
							onClick={() => void decide("approve")}
							variant="primary"
						>
							{saving() ? "Saving…" : "Approve & save"}
						</Button>
						<Button
							size="sm"
							type="button"
							disabled={saving() || _props.streaming || loading()}
							onClick={() => void decide("reject")}
							variant="ghost"
						>
							Decline
						</Button>
					</>
				)}
				{view()?.savedSkillId && (
					<Button
						size="sm"
						type="button"
						onClick={() => {
							const skillId = view()?.savedSkillId;
							if (skillId)
								openSkills({
									mode: "edit",
									skillId,
								});
						}}
						variant="ghost"
					>
						Edit skill
					</Button>
				)}
			</div>
		</section>
	);
}
