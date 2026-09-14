import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function check(source: string) {
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
						new URL("../../native/core/", import.meta.url),
					),
				},
			},
		);
		if (result.error) throw result.error;
		const diagnostics = result.stderr
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const diagnostic = JSON.parse(line) as {
					code?: { code?: string };
					spans?: { is_primary: boolean; line_start: number }[];
				};
				return {
					code: diagnostic.code?.code,
					line: diagnostic.spans?.find((span) => span.is_primary)?.line_start,
				};
			});
		return { status: result.status, diagnostics };
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test("core rejects platform access through aliases, methods, types and macros", () => {
	const cases = [
		[
			'use std::fs::read as load; pub fn run() { let _ = load("file"); }',
			"disallowed_methods",
		],
		[
			"pub fn run(path: std::path::PathBuf) { let _ = path.canonicalize(); }",
			"disallowed_methods",
		],
		[
			"mod nested { pub fn run() { let _ = std::env::current_dir(); } }",
			"disallowed_methods",
		],
		[
			'use std::process::Command as Process; pub fn run() { let _ = Process::new("git"); }',
			"disallowed_types",
		],
		[
			'pub fn run() { let _ = std::net::TcpStream::connect("localhost:1"); }',
			"disallowed_types",
		],
		['pub fn run() { println!("hello"); }', "disallowed_macros"],
	];
	const result = check(
		cases
			.map(([source], index) => `mod fixture_${index} { ${source} }`)
			.join("\n"),
	);
	expect(result.status).not.toBe(0);
	cases.forEach(([, lint], index) => {
		expect(result.diagnostics).toContainEqual({
			code: `clippy::${lint}`,
			line: index + 2,
		});
	});
});
