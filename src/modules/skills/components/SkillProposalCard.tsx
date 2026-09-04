import * as stylex from "@octanejs/stylex";
import { useRef, useState } from "octane";
import {
	readStoredJson,
	writeStoredJson,
} from "../../../adapters/storage/stored-values.ts";
import {
	color,
	controlSize,
	font,
	radius,
	surfaceStyles,
} from "../../../design-system/styles.stylex.ts";
import { usePrompts } from "../../prompts/hooks/usePrompts.tsx";
import { openSkills } from "../model/skill-events.ts";
import type { SkillProposal, SkillRead } from "../model/skill-proposal.ts";

type Outcome = { status: "saved"; skillId: string } | { status: "rejected" };

export function SkillReadCard({ skill }: { skill: SkillRead }) {
	return (
		<section
			aria-label={`Skill: ${skill.name}`}
			{...stylex.props(surfaceStyles.panel, styles.card)}
		>
			<div {...stylex.props(styles.heading)}>
				<strong>Skill found</strong>
				<code>/{skill.command}</code>
			</div>
			<p {...stylex.props(styles.reason)}>{skill.description || skill.name}</p>
			<details>
				<summary>Instructions</summary>
				<pre {...stylex.props(styles.instructions)}>{skill.promptTemplate}</pre>
			</details>
			<div {...stylex.props(styles.actions)}>
				<button
					type="button"
					onClick={() => openSkills({ mode: "edit", skillId: skill._id })}
					{...stylex.props(styles.button)}
				>
					{skill.isBuiltIn ? "View skill" : "Edit skill"}
				</button>
			</div>
		</section>
	);
}

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
	const { prompts, createPrompt, updatePrompt, loading } = usePrompts();
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
	const existing = prompts.find((skill) => skill._id === proposal.skillId);
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
					? await createPrompt(data)
					: await updatePrompt(proposal.skillId!, {
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

const styles = stylex.create({
	card: {
		marginBlock: controlSize._3,
		padding: controlSize._4,
		fontSize: font.size_2,
		color: color.textSoft,
	},
	heading: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: controlSize._2,
		color: color.textMain,
	},
	reason: { color: color.textMuted, marginBlock: controlSize._2 },
	instructions: {
		whiteSpace: "pre-wrap",
		overflowWrap: "anywhere",
		maxHeight: "320px",
		overflowY: "auto",
		backgroundColor: color.background,
		padding: controlSize._3,
		borderRadius: radius.md,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
	},
	actions: { display: "flex", gap: controlSize._2, marginTop: controlSize._3 },
	button: {
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.md,
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._3,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		color: color.textSoft,
		":disabled": { opacity: 0.5 },
	},
	approve: { backgroundColor: color.controlActive, color: color.textMain },
});
