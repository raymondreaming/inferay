const guidance = `

Working rules
Read the project instructions and the resources supplied to this run before drawing conclusions. Follow the selected repository scope; for a project-wide task, identify which linked repositories and resources are relevant. Use accessible evidence only. Do not assume access to chat history, external integrations, previous runs, or credentials. Explicitly list missing inputs and proceed with the useful work that remains.

Ground material findings in file paths, document headings, or available source links. Separate verified facts, interpretations, and open questions. Never invent metrics, decisions, owners, customer feedback, or completed work. If an earlier report is available, explain what changed instead of repeating it; otherwise state the period and scope inspected.

Save a dated Markdown report in the run output directory provided in the execution context. Finish with a short summary of the most useful findings, blockers, and the saved path. These starter tasks produce drafts and recommendations: do not publish, send messages, change application code, install dependencies, or enable other automations. If an input or capability is unavailable, report that clearly rather than claiming success.`;

export const automationStarters = [
	{
		name: "Start from scratch",
		description: "Write your own task and choose a schedule.",
		instructions: "",
		intervalSeconds: null,
	},
	{
		name: "Project briefing",
		description:
			"An evidence-based review of progress, decisions, risks, and next steps.",
		intervalSeconds: 604800,
		instructions:
			`Prepare a useful weekly briefing for someone returning to this project.

1. Establish the project's purpose, intended audience, current priorities, and constraints from its instructions and attached resources. Identify the reporting period; default to the last seven days.
2. Review relevant documents and repository activity in that period. Distinguish completed work from drafts, experiments, and uncommitted changes. Read the actual changes where needed rather than treating commit titles as proof of outcomes.
3. Extract consequential decisions, dependencies, unresolved questions, and emerging risks. Explain why each matters to the project's goals. Do not infer commitments from casual notes.
4. Recommend at most five concrete next actions, ordered by impact and dependency. Include the evidence, expected outcome, and any decision needed to start. Name an owner only when a source establishes one.

Output: executive summary; progress with references; decisions and rationale; risks and blockers; prioritized next actions; unanswered questions; sources and coverage. Keep the summary brief and place supporting detail below it.` +
			guidance,
	},
	{
		name: "Turn an idea into a plan",
		description:
			"Convert project goals and loose notes into a scoped, executable plan.",
		intervalSeconds: null,
		instructions:
			`Develop an implementation or delivery plan from the most clearly stated active goal in the project resources. If several goals compete, state the choice and its evidence. If no goal is stated, produce a short discovery brief rather than inventing a product direction.

Describe the intended user, problem, desired outcome, and constraints. Separate requirements from assumptions. Compare two or three practical approaches only where a real tradeoff exists, then recommend the simplest approach that meets the goal.

Break delivery into small milestones with observable acceptance criteria, dependencies, and verification steps. Identify what can be delivered first, which uncertainties need an experiment, and what should remain outside scope. Include data, integration, accessibility, and operational considerations when relevant. Avoid unsupported time estimates; express uncertain effort as a range with its assumptions.

Output: problem and outcome; evidence; scope and exclusions; recommended approach; milestone checklist; acceptance criteria; risks; decisions needed before implementation. Finish with the first concrete task someone could pick up.` +
			guidance,
	},
	{
		name: "Research brief",
		description:
			"Synthesize available research into findings, uncertainty, and decisions.",
		intervalSeconds: null,
		instructions:
			`Investigate the most explicit open research question in the project instructions or resources. State the question, intended decision, and boundaries before starting. When the question is missing, identify candidate questions and summarize existing knowledge without pretending to have a research mandate.

Inventory relevant local notes, documents, datasets, and supplied links. Read the underlying evidence and compare independent sources where available. Record source dates and distinguish primary evidence from secondhand summaries. Use external sources only when the run actually has access and the task calls for them; otherwise identify the resulting coverage gap.

Explain points of agreement, disagreements, limitations, and what would change the conclusion. Do not turn missing data into a confident recommendation. Relate findings to the project's audience and constraints, rather than producing a generic topic overview.

Output: question; short answer with confidence and rationale; evidence table; competing explanations; implications for this project; recommended next investigation; annotated sources. Include any claims that require fresh verification.` +
			guidance,
	},
	{
		name: "Organize project knowledge",
		description:
			"Find duplicates, stale notes, missing context, and useful categories.",
		intervalSeconds: 604800,
		instructions:
			`Review the project's accessible knowledge resources and propose a clearer organization.

Build an inventory with each resource's purpose, subject, format, and relationship to the project. Group by useful topics or workflows inferred from the material, keeping the category set small. Distinguish exact duplicates from overlapping documents and different versions. Identify conflicting statements and stale references using evidence, not file age alone.

Recommend a canonical home for important facts, decisions, terminology, and reusable instructions. Identify orphaned notes that need context, resources with misleading names, and gaps that make future agent work harder. Preserve source provenance and explain any proposed merge. Never delete, move, or rewrite source material during this review.

Output: proposed category map; inventory; duplicate and conflict candidates with references; suggested canonical documents; missing context; prioritized cleanup checklist. Include draft summaries or suggested titles for the highest-value items so the recommendations are directly usable.` +
			guidance,
	},
	{
		name: "Mind and genome review",
		description:
			"Check project knowledge and drafts against the project's stated direction.",
		intervalSeconds: 604800,
		instructions:
			`Review consistency between this project's stated identity and its working material. Locate any supplied Mind, genome, brand, audience, positioning, voice, and project instruction resources. Describe what each actually establishes; these names do not imply that every project has those resources.

Extract explicit principles, terminology, audience needs, promises, and constraints. Compare a bounded selection of recent documents or drafts against them. Identify contradictions, ambiguous guidance, unsupported claims, and repeated exceptions. Distinguish deliberate evolution from accidental inconsistency when the evidence permits; otherwise flag the decision needed.

For each significant issue, cite the source principle and the conflicting material, explain the practical effect, and suggest a specific revision. Do not silently redefine the project's identity. If the foundational resources are absent, produce a proposed outline and questions needed to establish them.

Output: current direction summary; consistency findings ranked by impact; suggested wording; unresolved decisions; resource gaps; scope reviewed.` +
			guidance,
	},
	{
		name: "Content brief and draft",
		description:
			"Create a grounded content concept, outline, and editable first draft.",
		intervalSeconds: 604800,
		instructions:
			`Develop one useful content draft based on the project's explicit audience, goals, and available evidence. Use the attached brand, voice, Mind, or genome resources where present. Prefer a documented content need; if none exists, state a proposed topic and why it fits.

Define the reader, channel, reader takeaway, and intended action. Identify the source material that supports the central argument. Create a clear outline, then a complete first draft sized for the chosen format. Match the project's voice without repeating slogans or making unsupported claims. Mark placeholders for facts, quotes, permissions, or product details that need confirmation.

Review the draft for factual support, clarity, repetition, accessibility, and alignment with the brief. Supply two alternative titles and a short explanation of meaningful editorial choices. Do not publish or distribute the draft.

Output: content brief; source notes; outline; full draft; title alternatives; self-review; checklist of remaining edits and evidence needed before publication.` +
			guidance,
	},
	{
		name: "Review recent changes",
		description:
			"Find concrete regressions and explain reproducible fixes with references.",
		intervalSeconds: 86400,
		instructions:
			`Review recent repository changes for actionable correctness problems. Respect the selected repository; for project-wide scope, identify the relevant linked repositories and inspect each separately. Default to the last day of commits plus current tracked working changes, and record the actual range reviewed.

Read repository instructions and the changed code together with its callers and tests. Prioritize broken behavior, data loss, authorization mistakes, invalid state transitions, and meaningful performance regressions. Check assumptions against the implementation. Avoid speculative warnings, formatting preferences, and findings that the change did not introduce unless clearly labeled pre-existing.

For each finding, provide severity, file and line reference, triggering conditions, observed or reasoned impact, and a focused correction. Run only relevant non-destructive checks when available; report exactly what was run and distinguish reproduction from inference. Do not modify the code in this review.

Output: findings ordered by impact; concise change summary; checks and results; coverage gaps. If no concrete issue is found, say so and describe remaining uncertainty rather than manufacturing findings.` +
			guidance,
	},
	{
		name: "Documentation check",
		description:
			"Compare instructions and examples with the implementation and current resources.",
		intervalSeconds: 604800,
		instructions:
			`Check whether the project's documentation remains useful and accurate. Identify its main entry points, setup instructions, architecture notes, user guidance, and operational procedures. Select the documents most affected by recent work and state the coverage.

Compare commands, file paths, configuration names, APIs, and described behavior with the current implementation or authoritative resources. Look for missing prerequisites, contradictory instructions, broken local references, and examples that no longer match. Do not run commands that install software or change state merely to test documentation.

Rank problems by their effect on a reader completing a real task. For the most important gaps, provide replacement paragraphs, corrected examples, or a proposed section outline. Recommend a single authoritative location for duplicated guidance and explain which references should point to it.

Output: prioritized findings with source references; proposed edits; missing documentation; checks performed; questions requiring a project decision. Preserve the distinction between verified inaccuracies and suggestions to improve clarity.` +
			guidance,
	},
	{
		name: "Release readiness review",
		description:
			"Assess a proposed release against evidence, checks, and operational needs.",
		intervalSeconds: null,
		instructions:
			`Assess readiness for the next explicitly identified release or milestone. Determine its scope and acceptance criteria from available project material; if no release is defined, produce a readiness checklist and list the missing decisions.

Review included changes, known issues, relevant test evidence, migrations, configuration changes, documentation, and compatibility implications. Identify dependencies on other repositories or services. Check whether rollout, monitoring, and rollback procedures are documented when the change needs them. Do not equate passing tests with complete release readiness.

Separate blocking issues from follow-up work. Every blocker needs an evidence reference, likely impact, and an observable resolution criterion. Do not claim live CI, deployment, or production health unless accessible evidence supports it. Do not deploy, tag, publish, or edit versions.

Output: readiness recommendation with limitations; release scope; blocker table; verification evidence; rollout and rollback gaps; documentation needs; final human decision checklist.` +
			guidance,
	},
	{
		name: "Reusable tool proposal",
		description:
			"Find repeated project work that would benefit from a small local tool.",
		intervalSeconds: null,
		instructions:
			`Identify one repeated, well-defined task in the project's available instructions, scripts, or workflow notes that could become a useful local tool. Do not assume access to prior conversations. First inspect existing tools and scripts so the proposal reuses capabilities already present.

Describe the current task, its inputs, expected output, failure cases, and why automation is worthwhile. Prefer a small deterministic script when possible; explain where agent judgment is genuinely required. Define the input schema, output contract, validation rules, working directory, dependencies, and permitted filesystem effects. State how secrets would be supplied without embedding them in files or reports.

Provide a concrete implementation outline or draft code in the report, representative input and output examples, and focused acceptance checks. Explain how an automation could invoke the tool and how failures should appear in run results. Do not install, register, or run the proposed tool.

Output: recommendation; reuse analysis; tool contract; implementation draft; examples; verification plan; integration steps and remaining decisions.` +
			guidance,
	},
];
