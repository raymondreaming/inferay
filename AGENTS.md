# Inferay agent instructions

Before changing code, read [CODING_GUIDELINES.md](CODING_GUIDELINES.md). It defines Inferay's dependency direction, outbound-network boundary, test-first workflow, and verification requirements.

Keep the Rust core independent of renderer and server concerns. Keep Solid modules as adapters around native models and browser interaction. Add or update the smallest relevant test before behavior changes; use `TEST_EXEMPT=1` only for documented exempt changes.
