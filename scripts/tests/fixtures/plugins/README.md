# Plugin conformance fixtures

These examples come from the local `inferay-proofs` design exercise. The Rust
validator, indexer and runtime are the implementation under test. The old Python
validator and runner are not copied: they implement a separate proposed model.

## Current fixture

`point/` is a portable project containing the Point daily autobuild library. Its
calendar is 08:00 America/Chicago. The skill has a stable UUID and the automation
references that UUID. Repository IDs have no machine paths. The unused proposed
Convex connection declaration is omitted; this version follows repository guides.

Run its native conformance check with:

```sh
cargo test -p inferay-server point_proof --lib
cargo test -p inferay-server shared_genome_edit --lib
```

The check copies files into a throwaway profile, validates the complete project,
requires an explicit repository binding, captures the calendar and skill inputs,
verifies that editing the skill changes approval inputs, refuses unapproved
execution, and rejects unknown fields, excess permissions and absolute working
directories. It never starts a provider, enables a schedule or touches Point's
real checkout. Passing this check does not prove the week-long unattended run.

## Real Origin quality gate

The opt-in check uses a local Origin checkout as the source for a disposable clone.
It creates a temporary Inferay profile, pins the actual `copy_check.py` by commit
and SHA-256, links the clone, reviews the inputs, and runs both passing and failing
captions through the native CLI tool runtime. Failed quality checks remain failed
runs with the checker’s JSON findings retained in stdout. It verifies the source
checkout stays clean. No provider, posting, or schedule is started.

```sh
INFERAY_ORIGIN_KIT_REPOSITORY=/path/to/Origin \
  cargo test -p inferay-server real_origin_copy_gate --lib -- --ignored --nocapture
```

The test prints the tested commit and entrypoint hash. It requires a trusted local
kit and Python 3. It exercises the real quality checker, not the render pipeline;
the separate checks below cover rendering and one scheduled occurrence.

## Real Blender render gate

```sh
INFERAY_ORIGIN_KIT_REPOSITORY=/path/to/Origin \
  cargo test -p inferay-server real_origin_blender_render --lib -- --ignored --nocapture
```

This uses the actual kit's `pillar-stack` scene in a disposable linked checkout,
with two samples and 108 × 144 output. It requires Blender 5 on PATH and expects
both the beauty and depth PNGs to appear in run history. It never enables a
schedule or posts. The disposable library and automation explicitly declare `gpu`;
all output still runs inside the required macOS sandbox. The check passes on Apple
Silicon with Blender 5.0.1. An attempted user-cache write is refused while both
rendered images are retained. Set `INFERAY_PROOF_OUTPUT_DIR` to export the two PNGs
for visual inspection; otherwise the temporary profile is removed after the test.

This proves a real render and artifact capture.

## Reusable studio library and scheduled workflow

`origin-studio/` contains a reusable Procedural studio library with two pinned
repository tools and a skill. Its daily automation lives separately under the
project's `automations/` folder. See its [library guide](origin-studio/plugins/procedural-studio/README.md).

```sh
cargo test -p inferay-server studio_library_fixture --lib
INFERAY_ORIGIN_KIT_REPOSITORY=/path/to/Origin \
  cargo test -p inferay-server real_scheduled_studio --lib -- --ignored --nocapture
```

The regular check validates the files, disabled initial state, binding refusal and
shared skill approval inputs. The opt-in check uses real Codex and Blender in a
disposable profile, approves only that temporary workflow and advances one due
occurrence through the scheduler. Both required tools must pass. The completed
run retains beauty/depth images, its response and provider conversation metadata.
It verifies the source remains clean. This gate passes with the pinned kit and
Blender 5.0.1; it consumes provider usage and never enables the user's schedules.

The preview is 108 × 144 with two samples. Checker success and render success are
execution evidence; they do not prove brand quality or that copy describes the
image accurately. Sustained daily operation and production quality remain open.

## Planned fixtures

`planned/hatch-content`, `planned/hatch-design`, and `planned/hatch-posting` retain
the original proposed library shapes as reference data. They are **not installable
current-format libraries**. They include unresolved repository packs, connections,
effects, MCP declarations and old argument/skill references. The posting Python
files are placeholders, not implementations. No test imports or executes them.

Move each planned example into the current fixture set only when the production
contract can express it and a native test exercises its behavior. Do not make a
second validator accept it just to turn a test green.

## Original eleven proof cases

| Original case | Current evidence / remaining work |
|---|---|
| Baseline definitions | Point fixture passes the native scanner; creative fixtures remain planned |
| Skill edit changes approval inputs | `point_proof` checks the captured input hash changes |
| Genome edit invalidates readers | `shared_genome_edit` checks two selected-record readers, immediate admission refusal, refresh disabling, unrelated approval retention and no automatic approval after reverting |
| Automation exceeds library permissions | `point_proof` rejects the extra permission |
| Absolute working directory | `point_proof` rejects it |
| Effect without budget | Planned with effects/outbox (M5) |
| Effect without handler | Planned with effects/outbox (M5) |
| Undeclared secret connection | Planned with Keychain connections (M5) |
| Unlinked repository | `point_proof` refuses capture until explicitly linked |
| Upstream kit change changes pin | `pack_resolution_checks_checkout_binding_revision_and_bytes` checks pins; `repository_tool_executes_in_place_and_dirty_checkout_revokes_approval` verifies in-place execution and outside-edit refusal |
| Unknown definition field | `point_proof` rejects `enabled` in the portable definition |

The regular server suite also covers actual CLI success/failure, tool grants,
requirement preflight, outside-edit approval invalidation, cancellation and
artifact retention. Opt-in real-provider gates are documented in
[the architecture guide](../../../../docs/architecture.md).
