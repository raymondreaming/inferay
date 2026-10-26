# Inferay agent instructions

GPUI (`native/gpui`) is the only desktop UI. The old Solid renderer and webview host have been deleted. All future UI work targets GPUI. Read [CODING_GUIDELINES.md](CODING_GUIDELINES.md) before changing code. Keep core pure, reuse shared Rust behavior, and verify actual interactions incrementally; the cutover does not imply all feature gaps are closed.

Documentation starts at [docs/README.md](docs/README.md). Before changing projects, plugins, skills, tools or automations, read [docs/concepts.md](docs/concepts.md) and [docs/reference/project-files.md](docs/reference/project-files.md). New automation capabilities follow [ADR 0002](docs/adr/0002-automation-kernel.md).
