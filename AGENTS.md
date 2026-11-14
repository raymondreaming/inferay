# Inferay agent instructions

Rune (`native/rune`, built on [Rune](https://github.com/anomalyco/rune)) is the only desktop UI. All UI work targets it. Read [CODING_GUIDELINES.md](CODING_GUIDELINES.md) before changing code and [native/rune/README.md](native/rune/README.md) before changing views. Keep core pure, reuse shared Rust behavior, and verify actual interactions incrementally; known feature gaps are listed in that README.

Documentation starts at [docs/README.md](docs/README.md). Before changing projects, plugins, skills, tools or automations, read [docs/concepts.md](docs/concepts.md) and [docs/reference/project-files.md](docs/reference/project-files.md). New automation capabilities follow [ADR 0002](docs/adr/0002-automation-kernel.md).
