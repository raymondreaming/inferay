# Inferay documentation

Start high and go lower only as far as the task needs.

| Level | Read | For |
|---|---|---|
| Product | [README](../README.md) | What Inferay is and does |
| Concepts | [concepts.md](concepts.md) | Projects, repositories, resources, skills, tools, plugins, automations, runs, and how they differ; current status of each |
| Architecture | [architecture.md](architecture.md) | How the app is built: processes, crates, renderer, provider runner, chat, storage, environment variables |
| Decisions | [adr/](adr/) | Why things are shaped this way: [0001](adr/0001-rust-models-solid-views.md) Rust models with Solid views; [0002](adr/0002-automation-kernel.md) the automation kernel |
| Reference | [reference/project-files.md](reference/project-files.md) | Exact definition file formats, limits, validation and local state |
| Working on the code | [CODING_GUIDELINES](../CODING_GUIDELINES.md), [CONTRIBUTING](../CONTRIBUTING.md), [design system](../src/design-system/README.md) | Rules, boundaries, setup, checks, releases |
| Performance | [performance-notes.md](performance-notes.md), [chat performance rules](../src/modules/conversation/PERFORMANCE.md) | Current measurements, approaches that do not help, chat-surface rules |
| Origin comparison | [origin-comparison.md](origin-comparison.md) | Every Origin feature next to Inferay: kept, rebuilt, left in Origin or dropped |
| Roadmap | [roadmap.md](roadmap.md) | What works, what is being built, what comes next, known gaps |

## Keeping docs current

- Each topic has one canonical page. Rewrite it when the code changes; do not append correction histories. Git keeps old versions.
- Mark anything not built as **planned**. Never describe intended behavior as shipped.
- Concepts and decisions stay free of source paths and line numbers; architecture and reference cite the owning code.
- Dated measurements and incident reports do not get their own pages. Fold the lasting lesson into the owning doc.
