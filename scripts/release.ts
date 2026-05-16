#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

const ROOT = resolve(import.meta.dir, "..");
const CLI_DIR = join(ROOT, "packages", "inferay");
const CLI_PACKAGE_JSON = join(CLI_DIR, "package.json");
const CLI_SOURCE = join(CLI_DIR, "src", "cli.js");
const ELECTROBUN_CONFIG = join(ROOT, "electrobun.config.ts");
const ARTIFACTS_DIR = join(ROOT, "artifacts");
const INSTALLER_DMG = join(ARTIFACTS_DIR, "inferay-installer.dmg");
const PLATFORM_DMG = join(ARTIFACTS_DIR, "inferay-macos-arm64.dmg");
const CHECKSUMS = join(ARTIFACTS_DIR, "checksums.txt");
const NPM_CACHE = "/private/tmp/inferay-npm-cache";
const DEFAULT_RELEASE_REPO = "raymondreaming/inferay";

type Bump = "major" | "minor" | "patch";

interface Options {
	bumpOrVersion: string;
	publishExisting: boolean;
	repo: string;
}

function usage() {
	console.log(`Usage:
  bun run release [patch|minor|major|new|x.y.z] [--repo owner/repo]
  bun run release --resume [--repo owner/repo]

Examples:
  bun run release
  bun run release minor
  bun run release 0.2.0
  bun run release --resume
`);
}

function parseArgs(): Options {
	const args = process.argv.slice(2);
	if (args.includes("--help") || args.includes("-h")) {
		usage();
		process.exit(0);
	}

	const repoIndex = args.indexOf("--repo");
	const repo =
		repoIndex >= 0
			? args[repoIndex + 1]
			: process.env.INFERAY_RELEASE_REPO || DEFAULT_RELEASE_REPO;
	if (!repo) throw new Error("--repo requires owner/repo");

	const positional = args.filter(
		(arg, index) =>
			!arg.startsWith("--") && !(repoIndex >= 0 && index === repoIndex + 1)
	);

	return {
		bumpOrVersion: positional[0] ?? "patch",
		publishExisting:
			args.includes("--resume") || args.includes("--publish-existing"),
		repo,
	};
}

function quoteArg(arg: string) {
	return /[\s"]/g.test(arg) ? JSON.stringify(arg) : arg;
}

async function run(
	cmd: string[],
	options: {
		cwd?: string;
		quiet?: boolean;
		allowFailure?: boolean;
		env?: NodeJS.ProcessEnv;
	} = {}
) {
	if (!options.quiet) console.log(`$ ${cmd.map(quoteArg).join(" ")}`);
	const proc = Bun.spawn(cmd, {
		cwd: options.cwd ?? ROOT,
		stdin: options.quiet ? "ignore" : "inherit",
		stdout: options.quiet ? "pipe" : "inherit",
		stderr: options.quiet ? "pipe" : "inherit",
		env: options.env ?? process.env,
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0 && !options.allowFailure) {
		throw new Error(
			`command failed (${exitCode}): ${cmd.map(quoteArg).join(" ")}`
		);
	}
	return exitCode;
}

async function capture(cmd: string[], options: { cwd?: string } = {}) {
	const proc = Bun.spawn(cmd, {
		cwd: options.cwd ?? ROOT,
		stdout: "pipe",
		stderr: "pipe",
		env: process.env,
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(
			`command failed (${exitCode}): ${cmd.map(quoteArg).join(" ")}\n${stderr}`
		);
	}
	return stdout.trim();
}

async function promptLine(question: string) {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		return (await rl.question(question)).trim();
	} finally {
		rl.close();
	}
}

function parseVersion(version: string) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!match) throw new Error(`invalid version: ${version}`);
	return match.slice(1).map(Number) as [number, number, number];
}

function bumpVersion(current: string, requested: string) {
	if (/^\d+\.\d+\.\d+$/.test(requested)) return requested;

	const bump: Bump = requested === "new" ? "patch" : (requested as Bump);
	if (!["major", "minor", "patch"].includes(bump)) {
		throw new Error(
			`expected patch, minor, major, new, or x.y.z; got ${requested}`
		);
	}

	const [major, minor, patch] = parseVersion(current);
	if (bump === "major") return `${major + 1}.0.0`;
	if (bump === "minor") return `${major}.${minor + 1}.0`;
	return `${major}.${minor}.${patch + 1}`;
}

async function readPackageVersion() {
	const pkg = JSON.parse(await readFile(CLI_PACKAGE_JSON, "utf8"));
	if (typeof pkg.version !== "string") {
		throw new Error("packages/inferay/package.json is missing version");
	}
	return pkg.version as string;
}

async function setCliVersion(version: string) {
	const pkg = JSON.parse(await readFile(CLI_PACKAGE_JSON, "utf8"));
	pkg.version = version;
	await writeFile(CLI_PACKAGE_JSON, `${JSON.stringify(pkg, null, "\t")}\n`);

	const source = await readFile(CLI_SOURCE, "utf8");
	const next = source.replace(
		/const VERSION = "\d+\.\d+\.\d+";/,
		`const VERSION = "${version}";`
	);
	if (next !== source) {
		await writeFile(CLI_SOURCE, next);
		return;
	}
	if (!source.includes("version: VERSION")) {
		throw new Error("could not update CLI VERSION constant");
	}
}

async function setDesktopVersion(version: string) {
	const source = await readFile(ELECTROBUN_CONFIG, "utf8");
	const next = source.replace(
		/version:\s*"\d+\.\d+\.\d+"/,
		`version: "${version}"`
	);
	if (next === source) {
		throw new Error("could not update desktop app version");
	}
	await writeFile(ELECTROBUN_CONFIG, next);
}

async function assertCleanGit() {
	const status = await capture(["git", "status", "--short"]);
	if (status) {
		throw new Error(`git worktree must be clean before release:\n${status}`);
	}
}

async function buildArtifacts(version: string) {
	await mkdir(ARTIFACTS_DIR, { recursive: true });
	await run(["bash", "scripts/build-dmg.sh"]);
	await copyFile(INSTALLER_DMG, PLATFORM_DMG);
	await run(
		[
			"npm",
			"pack",
			"--pack-destination",
			"../../artifacts",
			"--cache",
			NPM_CACHE,
		],
		{ cwd: CLI_DIR }
	);
	await writeChecksums([INSTALLER_DMG, PLATFORM_DMG]);
	await run(["hdiutil", "verify", INSTALLER_DMG]);
	await run(["hdiutil", "verify", PLATFORM_DMG]);

	const cliTarball = join(ARTIFACTS_DIR, `inferay-${version}.tgz`);
	console.log(`Created release artifacts:
  ${relative(INSTALLER_DMG)}
  ${relative(PLATFORM_DMG)}
  ${relative(cliTarball)}
  ${relative(CHECKSUMS)}`);
}

async function writeChecksums(paths: string[]) {
	const lines = [];
	for (const path of paths) {
		const hash = createHash("sha256");
		hash.update(await readFile(path));
		lines.push(`${hash.digest("hex")}  artifacts/${basename(path)}`);
	}
	await writeFile(CHECKSUMS, `${lines.join("\n")}\n`);
}

function relative(path: string) {
	return path.startsWith(ROOT) ? path.slice(ROOT.length + 1) : path;
}

async function commitAndTag(version: string) {
	const tag = `v${version}`;
	const existingTag = await run(["git", "rev-parse", "-q", "--verify", tag], {
		quiet: true,
		allowFailure: true,
	});
	if (existingTag === 0) throw new Error(`tag already exists: ${tag}`);

	await run([
		"git",
		"add",
		"electrobun.config.ts",
		"packages/inferay/package.json",
		"packages/inferay/src/cli.js",
	]);
	await run(["git", "commit", "-m", `release ${tag}`]);
	await run(["git", "tag", tag]);
}

async function releaseExists(tag: string, repo: string) {
	const exitCode = await run(["gh", "release", "view", tag, "--repo", repo], {
		quiet: true,
		allowFailure: true,
	});
	return exitCode === 0;
}

async function preflightPublish() {
	await run(["gh", "auth", "status"]);
	let npmUser: string | null = null;
	try {
		npmUser = await capture([
			"npm",
			"whoami",
			"--registry",
			"https://registry.npmjs.org",
			"--cache",
			NPM_CACHE,
		]);
	} catch {
		console.log("npm login required.");
		await run([
			"npm",
			"login",
			"--registry",
			"https://registry.npmjs.org",
			"--cache",
			NPM_CACHE,
		]);
		npmUser = await capture([
			"npm",
			"whoami",
			"--registry",
			"https://registry.npmjs.org",
			"--cache",
			NPM_CACHE,
		]);
	}
	console.log(`npm user: ${npmUser}`);
}

async function publishNpmPackage() {
	const cmd = ["npm", "publish", "--access", "public", "--cache", NPM_CACHE];
	let env = process.env;

	for (let attempt = 1; attempt <= 3; attempt++) {
		const exitCode = await run(cmd, {
			cwd: CLI_DIR,
			allowFailure: true,
			env,
		});
		if (exitCode === 0) return;
		if (attempt === 3) break;

		const answer = await promptLine(
			"Complete npm browser auth and press Enter to retry, or enter an npm OTP: "
		);
		env = answer ? { ...process.env, npm_config_otp: answer } : process.env;
	}

	throw new Error("npm publish failed after auth retries");
}

async function publishRelease(version: string, repo: string) {
	const tag = `v${version}`;
	await preflightPublish();
	await run(["git", "push", "origin", "HEAD", "--tags"]);

	const assets = [PLATFORM_DMG, INSTALLER_DMG, CHECKSUMS];
	if (await releaseExists(tag, repo)) {
		await run([
			"gh",
			"release",
			"upload",
			tag,
			...assets,
			"--repo",
			repo,
			"--clobber",
		]);
	} else {
		await run([
			"gh",
			"release",
			"create",
			tag,
			...assets,
			"--repo",
			repo,
			"--title",
			tag,
			"--notes",
			`Inferay ${tag}`,
		]);
	}

	await publishNpmPackage();
}

async function publishExisting(repo: string) {
	const version = await readPackageVersion();
	const tag = `v${version}`;
	await run(["test", "-f", PLATFORM_DMG]);
	await run(["test", "-f", INSTALLER_DMG]);
	await run(["test", "-f", CHECKSUMS]);
	await publishRelease(version, repo);
	console.log(`Published ${tag}`);
}

async function main() {
	const options = parseArgs();
	if (options.publishExisting) {
		await publishExisting(options.repo);
		return;
	}

	await assertCleanGit();
	const current = await readPackageVersion();
	const next = bumpVersion(current, options.bumpOrVersion);
	const tag = `v${next}`;

	console.log(`Preparing ${tag}`);
	await setCliVersion(next);
	await setDesktopVersion(next);
	await buildArtifacts(next);
	await commitAndTag(next);

	await publishRelease(next, options.repo);
	console.log(`Published ${tag}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
