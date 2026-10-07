# Inferay agent instructions

Before changing code, read [CODING_GUIDELINES.md](CODING_GUIDELINES.md). It defines Inferay's dependency direction, outbound-network boundary, refactoring workflow, and verification policy.

Keep the Rust core independent of renderer and server concerns. Keep Solid modules as adapters around native models and browser interaction. For refactors, establish the new implementation and ownership first; reconcile tests only once that direction is settled. Do not preserve obsolete APIs, wrappers, or execution paths to satisfy existing tests. Validate the completed batch with the smallest relevant checks.

Documentation starts at [docs/README.md](docs/README.md). Before changing projects, plugins, skills, tools or automations, read [docs/concepts.md](docs/concepts.md) and [docs/reference/project-files.md](docs/reference/project-files.md); new automation capabilities follow [ADR 0002](docs/adr/0002-automation-kernel.md): generic kernel concepts only, domain behavior in plugins. When a change alters a documented contract, update the canonical page in the same change.
