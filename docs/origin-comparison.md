# 🆚 Origin vs Inferay: every feature, side by side

Origin is the Hatching Point app that runs brand content, posting, ads and autonomous coding. Inferay is the coding-agent workspace we are growing into a general automation harness. This page lists **every** Origin feature, says what Inferay has today, and what happens to it: kept, rebuilt a simpler way, left in Origin, or dropped on purpose.

Milestones (M1–M7) refer to the [roadmap](roadmap.md). Concepts are explained in [concepts.md](concepts.md).

## 🔑 Legend

| Mark | Meaning |
|---|---|
| ✅ | Works |
| 🟡 | Partly works, or thin |
| 🛠️ | Planned in Inferay (milestone shown) |
| 🔄 | Comes to Inferay in a different, simpler form |
| ➡️ | Stays in Origin or its cloud service; Inferay does not replace it |
| 🗑️ | Dropped on purpose (with the reason) |
| 🤔 | Not decided yet |
| 💤 | Not built in Origin either |

## 🧭 The big picture in one minute

- 🧠 **How it decides.** Origin has an orchestrator per workspace that picks its own work, nonstop. Inferay runs **automations you approve**; anything that "decides what to do next" is a plugin built on top.
- 📦 **Where definitions live.** Origin keeps brand data, workflows and schedules in a local database (and partly in its cloud). Inferay keeps them as **files you can open, copy and share**.
- 🎨 **Domain features.** Origin builds brand, posting, Blender and ads features into the app. Inferay keeps the core generic, and every domain is a **plugin**.
- 🔁 **Learning.** Neither one learns on its own yet. Origin's own docs call it "the arrow that does not exist". Inferay plans it as observations plus proposals you approve (M6).

---

## 🖥️ 1. App shell and navigation

| Feature | Origin | Inferay | What happens |
|---|---|---|---|
| Sidebar of workspaces | ✅ brands and folders | ✅ projects (tabs) with sidebar | 🔄 projects replace brands/folders |
| Orchestrators roster | ✅ | ❌ | 🗑️ no always-on orchestrator; Automations page shows what's running |
| Graph (work map of goals) | ✅ | ✅ Git commit graph (different thing) | 🤔 a goal map isn't planned |
| History of decisions | ✅ | ✅ run history per automation | 🔄 |
| Activity (unfinished work) | ✅ | 🟡 run states on Automations | 🛠️ M2 Automations page becomes the "what's running" view |
| Workflows browser | ✅ | 🟡 Automations list | 🔄 automations inside plugins (M2) |
| Brand Books overview | 🟡 never opened live | ❌ | 🛠️ M4 brand plugin view over genome files |
| Chat / Editor / Origins side panes | ✅ | ✅ chat panes and document panes | 🔄 no "Origins" pane; project instructions and resources replace it |
| Command search | ✅ | ✅ command palette | ✅ |
| Menu bar popover | ✅ | ❌ | 🤔 |
| Menu-bar quick chat | ✅ | ❌ | 🤔 |
| Desktop widget | ✅ | ❌ | 🤔 |
| Glance settings | ✅ | ❌ | 🤔 |
| Onboarding | ✅ | ✅ | ✅ |
| Settings (themes, agents, keys, jobs…) | ✅ | ✅ settings, themes, GitHub, MCP toggles | 🔄 keys move to Connections (M5) |
| Subscription paywall | 🟡 built, bypassed in code | ❌ | 🤔 |
| Provider usage meters and token charts | ✅ | ❌ | 🤔 |
| Notifications on state change | ✅ | ❌ | 🛠️ worth adding with M3 (unattended runs) |
| Deep links (`klank://…`) | ✅ | ❌ | 🤔 |
| Product analytics events | ✅ | ❌ | 🤔 |
| Window and draft restoration | ✅ | ✅ workspace, panes and drafts persist | ✅ |
| Grid view | 🗑️ retired | ✅ chat grid (different idea) | ✅ |
| Brand Canvas | 🗑️ retired | ❌ | 🗑️ |

## 💻 2. Coding and repositories

| Feature | Origin | Inferay | What happens |
|---|---|---|---|
| File browser and search, @-mentions | ✅ | ✅ explorer, file search, @ files | ✅ |
| Code editor | ✅ | ❌ view-only documents | 🤔 agents edit; you review diffs |
| Built-in terminal | ✅ | ❌ | 🤔 |
| Git status, diffs, history, branches, commits | ✅ | ✅ graph, diffs, staging, commit, stash, discard, image diffs | ✅ Inferay is stronger here |
| AI commit messages | ❌ | ✅ | ✅ Inferay only |
| GitHub sign-in and clone | ✅ | ✅ forge accounts, repo list, clone | ✅ |
| Isolated copies (worktrees) for agents | ✅ automatic per goal | 🟡 worktrees visible and usable; not automatic per run | 🤔 per-run worktrees for automations |
| Checks tied to an exact revision | ✅ | 🟡 automations can run checks; not tied to a revision record | 🤔 |
| Approve & push with receipts | ✅ | 🟡 agents push if allowed; no receipt record | 🛠️ M3 permissions; receipts as effects (M5) |
| CI status after push | ✅ | ❌ | 🛠️ M6 as an observation |
| Commit lineage across rewrites | ✅ | ❌ | 🗑️ tied to Origin's publication receipts |
| Repair loop with budget | ✅ | ❌ | 🔄 a plugin automation ("fix failing checks, max N tries") |
| Merge plans for prerequisite work | ✅ | ❌ | 🗑️ part of the orchestrator |
| Task diff and publication review | ✅ | ✅ chat diff panel, changes panel | ✅ |
| Browser isolation for agents | ✅ | ❌ | 🤔 |
| Deploy | 💤 | ❌ | 🛠️ M5 as an effect with a budget, if wanted |
| Chat checkpoints (restore points) | ❌ | ✅ | ✅ Inferay only |

## 🤖 3. Agents and providers

| Feature | Origin | Inferay | What happens |
|---|---|---|---|
| Claude and Codex | ✅ | ✅ | ✅ |
| Cursor | ✅ | ❌ | 🤔 |
| Model catalog discovery | ✅ | ✅ provider config catalog | ✅ |
| Auto model routing | ✅ | ❌ you pick model and reasoning per chat or automation | 🤔 |
| Fallback when Codex is exhausted | ✅ | ❌ | 🤔 |
| Cost estimates and quota pacing | ✅ | ❌ | 🤔 |
| Chat UI: threads, history, tool cards, ask-user cards, images, diffs | ✅ | ✅ plus side-by-side panes, queued messages, speech-to-text, markdown streaming | ✅ Inferay is stronger here |
| Read provider history | ❌ | ✅ reads Claude and Codex session history | ✅ Inferay only |
| Chat skills (new-brand, publish-to-cloud, review-genome) | ✅ | 🟡 general skills library with proposal cards | 🔄 brand skills ship in the brand plugin (M4) |
| Workspace tools for chat (brand, genome, schedules…) | ✅ | 🟡 `inferay_projects` (Codex only) | 🛠️ M2 file commands for both Codex and Claude |
| Worker tools tied to one run | ✅ | ❌ | 🛠️ M3 tool grants per run (E7) |
| Skills living in repos (`.origin/skills`) | ✅ | ✅ project instructions; skills library | 🛠️ M2 skills inside plugins |
| Credential redaction | ✅ | ❌ | 🛠️ M5 connections keep keys out of prompts |
| MCP servers on/off per provider | 🟡 | ✅ | ✅ |
| Sandboxed agent permissions | 🟡 scoped write authority | ❌ full access today | 🛠️ M3 permission enforcement |

## 🧠 4. Orchestration and automation

| Feature | Origin | Inferay | What happens |
|---|---|---|---|
| Orchestrator per workspace that picks its own work | ✅ | ❌ | 🔄 a "planner" automation in a plugin can do this, under approval |
| Origins (direction, principles, metrics) | ✅ | 🟡 project instructions | 🔄 instructions + resources; metrics come as observations (M6) |
| Goals with acceptance criteria | ✅ | ❌ | 🔄 automation instructions and checks |
| Modes: Manual / Review / Demon | ✅ | 🟡 manual or scheduled, always approved | 🔄 review inbox for effects (M5); no "no approval" mode |
| Waits with reasons, continuity | ✅ | 🟡 `waiting_input` state | 🤔 |
| Recovery after crashes | ✅ | ✅ runs marked interrupted, never fake success | ✅ |
| Missions, team mode, scouts, opportunity ranking | ✅ | ❌ | 🗑️ orchestrator features; rebuild as plugins only if needed |
| Recipes / starters | ✅ | 🟡 example automation | 🔄 plugins are the starters |
| Named background jobs | ✅ 31 jobs | ✅ scheduler for automations | ✅ |
| Schedules: interval and calendar | ✅ | ✅ calendar times and timezones | ✅ |
| Admission limits | ✅ | ✅ 4 at once, 2 background | ✅ |
| Evidence journals per run | ✅ | ✅ events, logs, artifacts | ✅ |
| Approval tied to exact inputs | 🟡 genome digests | ✅ input hash; edits turn schedules off | ✅ Inferay is stricter |
| Definitions as readable files | ❌ database | 🛠️ M1 | 🛠️ |
| One card to approve a whole capability | ❌ | 🛠️ M2 | 🛠️ |
| Runs while app is closed | ❌ | ❌ | 🤔 later |

## 🗂️ 5. Workspaces

| Feature | Origin | Inferay | What happens |
|---|---|---|---|
| Product folders | ✅ | ✅ projects with linked repositories | ✅ |
| Acquisitions folders | 🟡 | ❌ | 🔄 any project with research plugins |
| Brand workspaces and parent/child brands | ✅ | 🟡 `parentBrandId` on brand records | 🛠️ M4 brand plugin |
| Write scope per workspace | ✅ | 🟡 per-automation `may` (not enforced yet) | 🛠️ M3 |
| Projects without any repo | ❌ | ✅ | ✅ Inferay only |
| Two projects sharing one repo | ❌ | ✅ | ✅ Inferay only |

## 🎨 6. Brand desk

| Feature | Origin | Inferay | What happens |
|---|---|---|---|
| Home → Overview (brand book) | ✅ | ❌ | 🛠️ M4 brand plugin view |
| Home → Mind (direction, memory) | ✅ | 🟡 Mind record editor | 🛠️ M4 real Mind schema; memory via Resources |
| Home → Intakes (Point Hatcher inbox, contracts) | ✅ | ❌ | ➡️ stays with Point / Origin |
| Make → Assets library (import, tags, review) | ✅ | 🟡 Resources library | 🛠️ M1–M2 Resources holds documents and images |
| Make → Characters (portraits, 3D) | ✅ | ❌ | 🛠️ M4 `brand.character` records + files |
| Out → Posts (compose, calendar) | ✅ | ❌ | 🛠️ M5 effects + review inbox; calendar is an Automations view |
| Out → Ads | ✅ | ❌ | 🤔 later, as an effect plugin |
| Out → Workflows | ✅ | 🟡 automations | 🔄 automations in plugins |
| Out → Results | ✅ | 🟡 run history | 🛠️ M6 observations |
| Setup → Connections | ✅ | ❌ | 🛠️ M5 Connections |
| Setup → Review inbox | ✅ | 🟡 approval cards | 🛠️ M5 review inbox |
| Setup → Advanced (products, diagnostics, genome) | ✅ | ❌ | 🔄 brand plugin + plain files |
| Map, Actions drawer | ✅ | ❌ | 🗑️ |

## 🧬 7. Brand identity (genome, Mind, characters)

| Feature | Origin | Inferay | What happens |
|---|---|---|---|
| Genome record with full schema | ✅ ~90–130 KB per brand | 🟡 colors, type and rules only | 🛠️ M4 brand plugin with the real schema; import Origin's 5 genomes |
| Genome lifecycle (draft → proofed → approved) | 🟡 | ❌ | 🔄 optional status field; real gate is approving automations that read it |
| Create a genome (form or chat interview) | 🟡 | ❌ | 🛠️ M4 brand plugin skill |
| Compile genome into lane briefs / palette files | 🟡 | ❌ | 🗑️ skills and tools read the genome directly, nothing to compile |
| Regenerate / rollback views | 🟡 | ❌ | 🗑️ no compiled views; Git or file history for rollback |
| Parity, diff, adopt, drift checks | ✅ | ❌ | 🗑️ no copies, so no drift |
| Lanes inside the genome | ✅ | ❌ | 🔄 lanes are automation files in a plugin |
| Palette roles and emitted palette JSON | ✅ | ❌ | 🔄 palette lives in the genome; scripts read it |
| Runs pinned to a genome digest | ✅ | 🟡 input hash covers selected resources | ✅ approval hash does this |
| Genome bundle export/import | 🟡 | 🛠️ | 🔄 copy the file |
| Brand guidance with inheritance | ✅ | 🟡 brand record | 🛠️ M4 |
| Mind steering with receipts | ✅ | 🟡 Mind instructions | 🛠️ M4; import needs Mitch's database or Origin Cloud |
| Mind evidence + retrieval (search) | ✅ | ❌ | 🛠️ Resources index + search (after M1) |
| Mind research packets | ✅ | ❌ | 🔄 documents in Resources |
| Mind budgets, emergency stop | 🟡 | ❌ | 🔄 effect budgets (M5); disabling automations is the stop |
| Ingredients (measured reference images) | 🟡 | ❌ | 🔄 kit scripts as tools + Resources records |
| Characters with portraits and USDZ | ✅ | ❌ | 🛠️ M4 |
| Products with Point ids | ✅ | ❌ | 🔄 a resource type in a plugin |
| `brand-ops.json` command file and hooks | ✅ | ❌ | 🗑️ chat + file edits + approvals replace it |
| Feedback reweighting, composer, proof scoring | 💤 | ❌ | 🛠️ M6 proposals from observations |
| Day numbering (genome: 1 = Sunday) | — | Inferay: 1 = Monday | ⚠️ convert when importing lanes |

## 🎬 8. Content production

| Feature | Origin | Inferay | What happens |
|---|---|---|---|
| Versioned workflows with steps | ✅ | 🟡 single-step automations | 🔄 small automations + events (M6), no workflow engine |
| Step kinds (context, ideate, copy, studio, evaluate, approve, schedule) | ✅ | ❌ | 🔄 skills + tools inside one run, effects for scheduling |
| Studio render in Blender | ✅ | ❌ | 🛠️ M4 packs: kit scripts run in place |
| Studio history / variety | ✅ | ❌ | 🔄 skill instructions + run history as input |
| Source pack (allow-listed news feeds) | ✅ | ❌ | 🔄 a tool in a plugin (`network` permission) |
| FAL image generation | ✅ | ❌ | 🛠️ tool + connection (M3–M5) |
| Video generation | 💤 (ffmpeg vertical film ✅) | ❌ | 🛠️ M4 kit scripts |
| Carousel, Instagram format, media checks | ✅ | ❌ | 🛠️ M4 kit tools |
| Quality gates (copy check, critics, score bars) | ✅ | ❌ | 🛠️ M3–M4 scripts as CLI tools (proved: `copy_check.py` runs in place) |
| Weekly content program, lane verification | ✅ | ❌ | 🔄 automations per lane in a plugin |
| Workflow templates | ✅ | ❌ | 🔄 plugins you copy |
| Campaigns, experiments, UGC productions | 🟡 | ❌ | 🤔 |
| Planning and Fleeter imports | ✅ | ❌ | 🗑️ one-time Origin migrations |
| Live workflow health and posting repair | ✅ | 🟡 run states | 🛠️ M2 Automations page |
| Blender kit (characters, fonts, 35 modules, ~60 scripts) | ✅ | ❌ | 🛠️ M4 forked kit linked as a pack, never copied into Inferay |

## 📣 9. Publishing

| Feature | Origin | Inferay | What happens |
|---|---|---|---|
| Post Bridge accounts | ✅ | ❌ | 🛠️ M5 connection + handler plugin |
| Multiple Post Bridge keys | ✅ | ❌ | 🛠️ M5 connections |
| Durable outbox, no double posts | ✅ | ❌ | 🛠️ M5 effects |
| Local media upload | ✅ | ❌ | 🛠️ M5 handler tool |
| Daily multi-platform posting | ✅ | ❌ | 🛠️ M5 + M6 |
| Posting grants and renewal | ✅ | ❌ | 🔄 effect budgets with an end date |
| Cloud posting lease (one Mac posts) | ✅ | ❌ | 🗑️ Inferay is local-only; one Mac per brand by setup |
| Delivery observation, posting health | ✅ | ❌ | 🛠️ M6 observations |
| Post analytics sync | ✅ (not fed back) | ❌ | 🛠️ M6, and fed back into proposals |
| Mailbox key | 🟡 | ❌ | 🗑️ |

## 💸 10. Ads

| Feature | Origin | Inferay | What happens |
|---|---|---|---|
| Ad plans | ✅ | ❌ | 🤔 later plugin |
| Meta campaigns created paused, pinned contract | ✅ | ❌ | 🤔 effect plugin with spend budget, after M5 |
| Meta insights every 30 minutes | ✅ | ❌ | 🛠️ M6 observer |
| TikTok / Apple ad adapters | 🟡 | ❌ | 🗑️ |
| Brand-wide ad budget | 💤 | ❌ | 🔄 effect budgets (M5) |

## ☁️ 11. Cloud (origin-api) and finance

| Feature | Origin | Inferay | What happens |
|---|---|---|---|
| Shared brand records + JSON Schema | ✅ | ❌ | ➡️ stays in Origin Cloud; Inferay is local by design |
| Mac push/pull sync | ✅ | ❌ | 🗑️ sharing is copying plugin folders (Git optional) |
| Brand brief API for Point and sites | ✅ | ❌ | ➡️ stays in Origin Cloud |
| Posting leases, private asset bucket, per-caller keys | ✅ | ❌ | ➡️ |
| Finance portal: members, roles, invites | ✅ sandbox | ❌ | ➡️ stays in Origin Cloud |
| Agreements, proposals, signing, intakes | ✅ sandbox | ❌ | ➡️ |
| Settlements, Apple-derived lines | 🟡 | ❌ | ➡️ |
| Mercury imports, webhooks, recipients | 🟡 flagged off | ❌ | ➡️ |
| Mercury payouts and send-money | 💤 | ❌ | ➡️ |
| Stripe webhook inbox | ✅ | ❌ | ➡️ |

## 🛠️ 12. Operations tools

| Feature | Origin | Inferay | What happens |
|---|---|---|---|
| Managed build with cache | ✅ | ✅ `bun run build`, release tooling | ✅ |
| Orchestrator status snapshot | ✅ | 🟡 run history | 🔄 |
| Self-maintainer / solver | ✅ | ❌ | 🔄 an "Inferay upkeep" plugin that runs checks nightly |
| Prune stale goals / unjam workflows | ✅ | ❌ | 🗑️ not needed without the orchestrator |
| Performance sampling | ✅ | ✅ benchmarks, perf notes | ✅ |
| Release qualification | ✅ | ✅ release command, Playwright `verify:projects` | ✅ |
| Genome conformance | ✅ | ❌ | 🛠️ conformance suite from proofs (M3) |
| Offline maintenance command (`origin-resource-transfer`) | ✅ | ❌ | 🗑️ |
| Auto update check | ❌ | ✅ | ✅ Inferay only |

## 📈 13. Learning and metrics

| Feature | Origin | Inferay | What happens |
|---|---|---|---|
| Metric readings from analytics | ✅ | ❌ | 🛠️ M6 observations |
| Provenance (null ≠ zero, data-through dates) | ✅ | ❌ | 🛠️ M6 |
| Learning tab (accept/reject counts) | 🟡 | ❌ | 🤔 |
| Levers that declare which numbers they move | 💤 | ❌ | 🔄 effects declare kind and budget (M5) |
| Confirm step (pending / improved / not improved) | 💤 | ❌ | 🛠️ M6 |
| Results fed back into decisions | 💤 | ❌ | 🛠️ M6 review automation proposes changes |
| Proofs shared across apps | 💤 | ❌ | 🤔 after M6 |
| Brand "gets smarter" from results | 💤 | ❌ | 🛠️ M6, as proposals you approve |

---

## 🎁 What Inferay already does better

- 🪟 Side-by-side chats with Claude and Codex, queued messages, speech-to-text, checkpoints.
- 🌳 A fast Git workbench: graph, diffs, image diffs, staging, stash, discard, AI commit messages.
- 🔐 Stricter approvals: any change to an automation's inputs turns it off until you approve again.
- 📂 Projects that don't need a repo, or share one repo across several projects.
- 📄 Definitions as files (M1): you can read, copy and share everything an automation uses.

## 🧳 What we must bring from Origin

1. 🧬 The **five brand genomes** (in Origin's Git): easy, M4.
2. 🧠 **Mind memory and steering, characters, ingredients**: these live in Mitch's local database and Origin Cloud, not Git. They need an export. Start this early.
3. 🎨 The **Blender kit** (modules, scripts, characters, fonts): fork it and link it as a pack, M4.
4. 📣 The **posting safety rules**: outbox before sending, no duplicates, receipts. M5.

## 🗑️ What we leave behind on purpose

- The always-on orchestrator, missions, scouts and Demon mode. Automations plus approvals replace them.
- Genome compiling, regenerating, parity and drift checks. Nothing to compile when skills read the genome directly.
- `brand-ops.json` and offline maintenance commands. Chat and files replace them.
- Cloud sync of brand data inside the app. Inferay stays local; Origin Cloud keeps serving Point, sites and finance.

## ➡️ What stays in Origin Cloud

The finance portal, the brand brief API for Point and sites, shared brand records and the asset bucket. Inferay does not need to replace any of it.
