# Procedural studio

A reusable library for procedural Blender stills and caption checks. The scene
code stays in a linked Origin checkout. This folder contains the callable
contracts and the skill that explains how to use them.

## Capabilities

- **Render procedural still:** pillar-stack, pebble-ring or arch-glow; explicit
  seed, scale and sample count; beauty and depth PNGs retained as run artifacts.
- **Check caption:** Origin's factual-copy rules for Instagram; findings retained
  in tool stdout; a nonzero exit is a failed check.
- **Procedural studio skill:** draft, check, render and report with honest evidence.

## Local setup

The project must declare and bind repository
`ceb98bdc-9cb0-5d60-b4e5-b17026f15a20` to a clean Origin checkout at commit
`271fb05956913c730a5f496378406677e03f422f`. Tool manifests pin the actual
entrypoint bytes too. No kit scripts are copied into this library.

Blender 5 and Python 3 are required. Rendering currently uses the Apple Silicon
macOS sandbox adapter. Review `gpu` permission on the library and on any workflow
that calls its renderer. It adds graphics runtime access, not socket access or
permission to write to the repository or your personal Blender settings.

The example project's daily workflow lives in `automations/daily-studio/`, outside
this library. It is scheduled for 09:00 America/Chicago and arrives unapproved and
disabled. Its renderer and caption checker are required grants. A missing or
failed check prevents a successful run; a successful retry can recover it.

The preview settings (scale 0.1, two samples) prove execution, not production
quality. Nothing posts, installs software, grants provider shell GPU access, or
changes your existing projects. Brand-quality review, production settings and
publication are separate work.
