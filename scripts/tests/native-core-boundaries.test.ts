import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function check(source: string, crate = "core") {
	const directory = mkdtempSync(join(tmpdir(), "inferay-core-boundary-"));
	try {
		const input = join(directory, "fixture.rs");
		writeFileSync(input, `#![allow(dead_code, unused_imports)]\n${source}`);
		const result = spawnSync(
			"clippy-driver",
			[
				"--crate-type=lib",
				"--edition=2024",
				"--emit=metadata",
				"--error-format=json",
				"-Dclippy::disallowed_methods",
				"-Dclippy::disallowed_types",
				"-Dclippy::disallowed_macros",
				"--out-dir",
				directory,
				input,
			],
			{
				encoding: "utf8",
				timeout: 30_000,
				env: {
					...process.env,
					CLIPPY_CONF_DIR: fileURLToPath(
						new URL(`../../native/${crate}/`, import.meta.url),
					),
				},
			},
		);
		if (result.error) throw result.error;
		const codes = result.stderr
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const diagnostic = JSON.parse(line) as { code?: { code?: string } };
				return diagnostic.code?.code;
			});
		return { status: result.status, codes };
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test.each([
	[
		"aliased file reads",
		'use std::fs::read as load; pub fn run() { let _ = load("file"); }',
		"disallowed_methods",
	],
	[
		"PathBuf autoderef",
		"pub fn run(path: std::path::PathBuf) { let _ = path.canonicalize(); }",
		"disallowed_methods",
	],
	[
		"nested environment reads",
		"mod new_module { pub fn run() { let _ = std::env::current_dir(); } }",
		"disallowed_methods",
	],
	[
		"process types",
		'use std::process::Command as Process; pub fn run() { let _ = Process::new("git"); }',
		"disallowed_types",
	],
	[
		"network types",
		'pub fn run() { let _ = std::net::TcpStream::connect("localhost:1"); }',
		"disallowed_types",
	],
	["stdout writes", 'pub fn run() { println!("hello"); }', "disallowed_macros"],
])("core rejects %s", (_name, source, lint) => {
	const result = check(source);
	expect(result.status).not.toBe(0);
	expect(result.codes).toContain(`clippy::${lint}`);
});

test("core permits pure path operations and platform names in data", () => {
	expect(
		check(
			'pub fn run(path: &std::path::Path) -> usize { let _text = "std::fs::read"; path.components().count() }',
		).status,
	).toBe(0);
});

test("the server retains its platform capabilities", () => {
	expect(
		check('pub fn run() { let _ = std::fs::read("file"); }', "server").status,
	).toBe(0);
});
