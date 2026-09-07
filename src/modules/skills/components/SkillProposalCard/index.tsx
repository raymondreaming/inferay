import * as stylex from "@octanejs/stylex";
import { useRef, useState } from "octane";
import type { SkillProposal } from "../../../../../build/presentation/contracts/SkillProposal.ts";
import type { SkillProposalView } from "../../../../../build/presentation/contracts/SkillProposalView.ts";
import { postJson } from "../../../../adapters/backend/http.ts";
import { surfaceStyles } from "../../../../design-system/styles.stylex.ts";
import { useQueryResource } from "../../../../shared/hooks/useQueryResource.tsx";
import { openSkills } from "../../../../shared/lib/data.ts";
import { decideSkillProposal } from "../../hooks/useSkills.tsx";
import { styles } from "./styles.ts";

export function SkillProposalCard({
	proposal,
	messageId,
	streaming,
	onResult,
}: {
	proposal: SkillProposal;
	messageId: string;
	streaming?: boolean;
	onResult?: (text: string) => void;
}) {
	const resource = useQueryResource<SkillProposalView | null>(
		(signal) =>
			postJson("/api/prompts/proposal", { messageId, proposal }, { signal }),
		null,
		{
			queryKey: ["skills", "proposal", messageId, proposal],
			enabled: !streaming,
		},
	);
	const view = resource.data;
	const loading = !resource.loaded || resource.loading;
	const inFlight = useRef(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const decide = async (decision: "approve" | "reject") => {
		if (
			inFlight.current ||
			streaming ||
			loading ||
			view?.decided ||
			(decision === "approve" && view?.blockedReason)
		)
			return;
		inFlight.current = true;
		setSaving(true);
		setError("");
		try {
			const result = await decideSkillProposal(messageId, proposal, decision);
			resource.setData(result);
			if (result.message) onResult?.(result.message);
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
			aria-label={`Skill proposal: ${proposal.name}`}
			{...stylex.props(surfaceStyles.panel, styles.card)}
		>
			<div {...stylex.props(styles.heading)}>
				<strong>{view?.title ?? "Skill proposal"}</strong>
				<code>/{proposal.command}</code>
			</div>
			<p {...stylex.props(styles.reason)}>{proposal.reason}</p>
			<p>
				{proposal.name} — {proposal.description}
			</p>
			{view?.currentInstructions != null && (
				<details>
					<summary>Current instructions</summary>
					<pre {...stylex.props(styles.instructions)}>
						{view.currentInstructions}
					</pre>
				</details>
			)}
			<details open={!view?.decided}>
				<summary>Proposed instructions</summary>
				<pre {...stylex.props(styles.instructions)}>
					{proposal.promptTemplate}
				</pre>
			</details>
			{view?.blockedReason && <p role="alert">{view.blockedReason}</p>}
			{(error || resource.error) && (
				<p role="alert">{error || resource.error}</p>
			)}
			<div role="status" {...stylex.props(styles.reason)}>
				{saving ? "Saving decision…" : (view?.status ?? "Loading proposal…")}
			</div>

			<div {...stylex.props(styles.actions)}>
				{!view?.decided && (
					<>
						<button
							type="button"
							disabled={saving || streaming || loading || !!view?.blockedReason}
							onClick={() => void decide("approve")}
							{...stylex.props(styles.button, styles.approve)}
						>
							{saving ? "Saving…" : "Approve & save"}
						</button>
						<button
							type="button"
							disabled={saving || streaming || loading}
							onClick={() => void decide("reject")}
							{...stylex.props(styles.button)}
						>
							Decline
						</button>
					</>
				)}
				{view?.savedSkillId && (
					<button
						type="button"
						onClick={() =>
							openSkills({ mode: "edit", skillId: view.savedSkillId! })
						}
						{...stylex.props(styles.button)}
					>
						Edit skill
					</button>
				)}
			</div>
		</section>
	);
}

export { SkillReadCard } from "./SkillReadCard.tsx";
