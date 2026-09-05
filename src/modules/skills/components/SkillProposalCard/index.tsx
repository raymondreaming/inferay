import * as stylex from "@octanejs/stylex";
import { useRef, useState } from "octane";
import {
	readStoredJson,
	writeStoredJson,
} from "../../../../adapters/storage/stored-values.ts";
import { surfaceStyles } from "../../../../design-system/styles.stylex.ts";
import { useSkills } from "../../hooks/useSkills.tsx";
import { openSkills } from "../../model/skill-events.ts";
import type { SkillProposal } from "../../model/skill-library.ts";
import { styles } from "./styles.ts";

type Outcome = { status: "saved"; skillId: string } | { status: "rejected" };

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
	const { skills, createSkill, updateSkill, loading } = useSkills(true);
	const key = `inferay-skill-proposal:${messageId}`;
	const signature = JSON.stringify(proposal);
	const [outcome, setOutcome] = useState<Outcome | null>(() => {
		const stored = readStoredJson<{
			proposal: string;
			outcome: Outcome;
		} | null>(key, null);
		return stored?.proposal === signature ? stored.outcome : null;
	});
	const inFlight = useRef(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const existing = skills.find((skill) => skill._id === proposal.skillId);
	const stale =
		proposal.action === "update" &&
		!loading &&
		(!existing ||
			existing.isBuiltIn ||
			existing.updatedAt !== proposal.expectedUpdatedAt);
	const finish = (result: Outcome) => {
		setOutcome(result);
		writeStoredJson(key, { proposal: signature, outcome: result });
	};
	const approve = async () => {
		if (inFlight.current || saving || outcome || streaming || loading || stale)
			return;
		inFlight.current = true;
		setSaving(true);
		setError("");
		try {
			const data = {
				name: proposal.name,
				command: proposal.command,
				description: proposal.description,
				promptTemplate: proposal.promptTemplate,
			};
			const saved =
				proposal.action === "create"
					? await createSkill(data)
					: await updateSkill(proposal.skillId!, {
							...data,
							expectedUpdatedAt: proposal.expectedUpdatedAt,
						});
			finish({ status: "saved", skillId: saved._id });
			onResult?.(
				`I approved the skill proposal. Inferay successfully ${proposal.action === "create" ? "created" : "updated"} /${saved.command} (skill ID: ${saved._id}).`,
			);
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
				<strong>
					{outcome?.status === "saved"
						? "Skill saved"
						: outcome?.status === "rejected"
							? "Skill change declined"
							: proposal.action === "create"
								? "Create skill"
								: "Update skill"}
				</strong>
				<code>/{proposal.command}</code>
			</div>
			<p {...stylex.props(styles.reason)}>{proposal.reason}</p>
			<p>
				{proposal.name} — {proposal.description}
			</p>
			{proposal.action === "update" && existing && (
				<details>
					<summary>Current instructions</summary>
					<pre {...stylex.props(styles.instructions)}>
						{existing.promptTemplate}
					</pre>
				</details>
			)}
			<details open={!outcome}>
				<summary>Proposed instructions</summary>
				<pre {...stylex.props(styles.instructions)}>
					{proposal.promptTemplate}
				</pre>
			</details>
			{stale && !outcome && (
				<p role="alert">
					This skill changed or is no longer editable. Ask the agent for a fresh
					proposal.
				</p>
			)}
			{error && <p role="alert">{error}</p>}
			<div role="status" {...stylex.props(styles.reason)}>
				{saving
					? "Saving skill…"
					: outcome?.status === "saved"
						? "Saved to your local skills library."
						: outcome?.status === "rejected"
							? "No changes were made."
							: "Your approval is required. Nothing has been changed."}
			</div>
			<div {...stylex.props(styles.actions)}>
				{!outcome && (
					<>
						<button
							type="button"
							disabled={saving || streaming || loading || stale}
							onClick={() => void approve()}
							{...stylex.props(styles.button, styles.approve)}
						>
							{saving ? "Saving…" : "Approve & save"}
						</button>
						<button
							type="button"
							disabled={saving || streaming}
							onClick={() => {
								finish({ status: "rejected" });
								onResult?.(
									`I declined the proposed skill change for /${proposal.command}. Do not apply it.`,
								);
							}}
							{...stylex.props(styles.button)}
						>
							Decline
						</button>
					</>
				)}
				{outcome?.status === "saved" && (
					<button
						type="button"
						onClick={() =>
							openSkills({ mode: "edit", skillId: outcome.skillId })
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
