import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal } from "solid-js";
import type { SkillProposal } from "../../../../../build/presentation/contracts/SkillProposal.ts";
import type { SkillProposalView } from "../../../../../build/presentation/contracts/SkillProposalView.ts";
import { surfaceStyles } from "../../../../design-system/styles.stylex.ts";
import { useQueryResource } from "../../../../shared/hooks/useQueryResource.tsx";
import { ariaValue, openSkills } from "../../../../shared/lib/dom.tsx";
import { postJson } from "../../../../shared/lib/native.tsx";
import { decideSkillProposal } from "../../hooks/useSkills.tsx";
import { styles } from "./styles.ts";
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
			return (signal) => postJson("/api/prompts/proposal", input, { signal });
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
			<div {...stylex.attrs(styles.heading)}>
				<strong>{view()?.title ?? "Skill proposal"}</strong>
				<code>/{_props.proposal.command}</code>
			</div>
			<p {...stylex.attrs(styles.reason)}>{_props.proposal.reason}</p>
			<p>
				{_props.proposal.name} — {_props.proposal.description}
			</p>
			{view()?.currentInstructions != null && (
				<details>
					<summary>Current instructions</summary>
					<pre {...stylex.attrs(styles.instructions)}>
						{view()?.currentInstructions}
					</pre>
				</details>
			)}
			<details open={!view()?.decided}>
				<summary>Proposed instructions</summary>
				<pre {...stylex.attrs(styles.instructions)}>
					{_props.proposal.promptTemplate}
				</pre>
			</details>
			{view()?.blockedReason && <p role="alert">{view()?.blockedReason}</p>}
			{(error() || resource.error) && (
				<p role="alert">{error() || resource.error}</p>
			)}
			<div role="status" {...stylex.attrs(styles.reason)}>
				{saving()
					? "Saving decision…"
					: (view()?.status ?? "Loading proposal…")}
			</div>

			<div {...stylex.attrs(styles.actions)}>
				{!view()?.decided && (
					<>
						<button
							type="button"
							disabled={
								saving() ||
								_props.streaming ||
								loading() ||
								!!view()?.blockedReason
							}
							onClick={() => void decide("approve")}
							{...stylex.attrs(styles.button, styles.approve)}
						>
							{saving() ? "Saving…" : "Approve & save"}
						</button>
						<button
							type="button"
							disabled={saving() || _props.streaming || loading()}
							onClick={() => void decide("reject")}
							{...stylex.attrs(styles.button)}
						>
							Decline
						</button>
					</>
				)}
				{view()?.savedSkillId && (
					<button
						type="button"
						onClick={() => {
							const skillId = view()?.savedSkillId;
							if (skillId)
								openSkills({
									mode: "edit",
									skillId,
								});
						}}
						{...stylex.attrs(styles.button)}
					>
						Edit skill
					</button>
				)}
			</div>
		</section>
	);
}
export { SkillReadCard } from "./SkillReadCard.tsx";
