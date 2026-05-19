import { describe, expect, test } from "bun:test";
import { findAsset, releaseApiUrl } from "../packages/inferay/src/releases.js";

describe("release metadata mapping", () => {
	/*
	 * This protects installer stability at the external API boundary. GitHub
	 * release assets can contain multiple packages, so the CLI must select the
	 * platform-specific DMG before generic fallbacks or users can download the
	 * wrong artifact during install or launch repair.
	 */
	test("prefers exact platform dmg assets before generic dmg or archive fallbacks", () => {
		const release = {
			assets: [
				{ name: "inferay-macos-arm64.tar.zst" },
				{ name: "inferay-macos-universal.dmg" },
				{ name: "inferay-macos-arm64.dmg" },
				{ name: "inferay-checksums.txt" },
			],
		};

		expect(
			findAsset(release, { os: "macos", cpu: "arm64", target: "macos-arm64" })
		).toEqual({ name: "inferay-macos-arm64.dmg" });
	});

	/*
	 * This protects release channel resolution without touching the network. The
	 * installer maps "stable" to GitHub's latest endpoint and named channels to
	 * tag lookups; a regression here breaks deploy or beta install workflows
	 * before download logic even runs.
	 */
	test("maps stable and tagged release channels to the expected GitHub endpoints", () => {
		const previousRepo = process.env.INFERAY_RELEASE_REPO;
		const previousUrl = process.env.INFERAY_RELEASE_URL;
		process.env.INFERAY_RELEASE_REPO = "owner/repo";
		delete process.env.INFERAY_RELEASE_URL;

		try {
			expect(releaseApiUrl("stable")).toBe(
				"https://api.github.com/repos/owner/repo/releases/latest"
			);
			expect(releaseApiUrl("beta")).toBe(
				"https://api.github.com/repos/owner/repo/releases/tags/beta"
			);
		} finally {
			if (previousRepo === undefined) {
				delete process.env.INFERAY_RELEASE_REPO;
			} else {
				process.env.INFERAY_RELEASE_REPO = previousRepo;
			}
			if (previousUrl === undefined) {
				delete process.env.INFERAY_RELEASE_URL;
			} else {
				process.env.INFERAY_RELEASE_URL = previousUrl;
			}
		}
	});
});
