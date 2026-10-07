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
```

The check copies files into a throwaway profile, validates the complete project,
requires an explicit repository binding, captures the calendar and skill inputs,
verifies that editing the skill changes approval inputs, refuses unapproved
execution, and rejects unknown fields, excess permissions and absolute working
directories. It never starts a provider, enables a schedule or touches Point's
real checkout. Passing this check does not prove the week-long unattended run.

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
| Genome edit invalidates readers | Memory record indexing exists; shared-genome invalidation across every creative reader still needs a conformance check |
| Automation exceeds library permissions | `point_proof` rejects the extra permission |
| Absolute working directory | `point_proof` rejects it |
| Effect without budget | Planned with effects/outbox (M5) |
| Effect without handler | Planned with effects/outbox (M5) |
| Undeclared secret connection | Planned with Keychain connections (M5) |
| Unlinked repository | `point_proof` refuses capture until explicitly linked |
| Upstream kit change changes pin | Planned with repository packs (M4) |
| Unknown definition field | `point_proof` rejects `enabled` in the portable definition |

The regular server suite also covers actual CLI success/failure, tool grants,
requirement preflight, outside-edit approval invalidation, cancellation and
artifact retention. Opt-in real-provider gates are documented in
[the architecture guide](../../../../docs/architecture.md).
