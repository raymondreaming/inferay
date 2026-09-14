# Inferay agent instructions

Before changing code, read [CODING_GUIDELINES.md](CODING_GUIDELINES.md). It defines Inferay's dependency direction, outbound-network boundary, refactoring workflow, and verification policy.

Keep the Rust core independent of renderer and server concerns. Keep Solid modules as adapters around native models and browser interaction. For refactors, establish the new implementation and ownership first; reconcile tests only once that direction is settled. Do not preserve obsolete APIs, wrappers, or execution paths to satisfy existing tests. Validate the completed batch with the smallest relevant checks.
