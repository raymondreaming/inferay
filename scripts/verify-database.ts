import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

// This fixture owns its entire temporary profile. Never point it at live data.
const profile = await mkdtemp(join(tmpdir(), "inferay-database-"));
await writeFile(
	join(profile, "settings.json"),
	JSON.stringify({ search_folders: [] }),
);
const server = spawn("target/debug/inferay-dev-server", [], {
	env: {
		...process.env,
		INFERAY_USER_DATA_DIR: profile,
		INFERAY_DEV_APP_ROOT: process.cwd(),
		INFERAY_DEV_BACKEND_ADDR: "127.0.0.1:0",
		INFERAY_DISABLE_AUTOMATIONS: "1",
	},
	stdio: ["ignore", "pipe", "pipe"],
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
	const address = await new Promise<string>((resolve, reject) => {
		let log = "";
		const timer = setTimeout(
			() => reject(new Error(`Server startup timeout: ${log}`)),
			30000,
		);
		server.once("error", reject);
		server.once("exit", (code) => {
			clearTimeout(timer);
			reject(new Error(`Server exited ${code}: ${log}`));
		});
		server.stderr.on("data", (data) => {
			log += String(data);
		});
		server.stdout.on("data", (data) => {
			log += String(data);
			const match = log.match(/backend: (http:\/\/127\.0\.0\.1:\d+)/);
			if (match) {
				clearTimeout(timer);
				resolve(match[1]);
			}
		});
	});
	const db = new Database(join(profile, "projects.sqlite3"));
	db.run(
		"CREATE TABLE inspector_fixture(name TEXT PRIMARY KEY, payload TEXT, number INTEGER, absent TEXT, bytes BLOB)",
	);
	const insert = db.prepare(
		"INSERT INTO inspector_fixture VALUES(?1,?2,9223372036854775807,NULL,x'00FF')",
	);
	for (let i = 0; i < 60; i++)
		insert.run(
			i === 0 ? "100% literal" : `row-${String(i).padStart(2, "0")}`,
			i === 0 ? "🦀".repeat(70000) : `body-${i}`,
		);
	db.run(
		"CREATE TABLE inspector_composite(project TEXT,id TEXT,body TEXT,PRIMARY KEY(project,id)) WITHOUT ROWID",
	);
	db.run("INSERT INTO inspector_composite VALUES('p','n',?)", [
		"memory ".repeat(10000),
	]);
	db.close();
	browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 1500, height: 1000 },
	});
	page.setDefaultTimeout(15000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route("**/?inferay-live-reload=*", (route) =>
		route.fulfill({ status: 204, body: "" }),
	);
	await page.goto(address);
	await page.waitForFunction(
		() =>
			document.querySelector("[data-settings-page]") ||
			document.querySelector("button"),
	);
	await page.evaluate(() =>
		window.dispatchEvent(
			new CustomEvent("inferay-open-settings", {
				detail: { section: "database" },
			}),
		),
	);
	const explorer = page.getByRole("region", {
		name: "Database explorer",
		exact: true,
	});
	await explorer.waitFor();
	await explorer
		.getByRole("searchbox", { name: "Find table or view" })
		.fill("inspector_fixture");
	await explorer
		.getByRole("button", { name: "inspector_fixture table", exact: true })
		.click();
	const table = explorer.getByRole("table", { name: "inspector_fixture rows" });
	await table.getByRole("row").nth(50).waitFor();
	assert.equal(await table.getByRole("row").count(), 51);
	assert.equal(
		await table.getByTitle("Inspect number (integer)").first().textContent(),
		"9223372036854775807",
	);
	await explorer.getByRole("button", { name: "Next", exact: true }).click();
	await page.waitForFunction(
		() =>
			document.querySelectorAll(
				'table[aria-label="inspector_fixture rows"] tbody tr',
			).length === 10,
	);
	await explorer.getByRole("textbox", { name: "Contains text" }).fill("%");
	await explorer.getByRole("button", { name: "Filter", exact: true }).click();
	await page.waitForFunction(
		() =>
			document.querySelectorAll(
				'table[aria-label="inspector_fixture rows"] tbody tr',
			).length === 1,
	);
	await table.getByTitle("Inspect payload (text)").click();
	const inspector = explorer.getByRole("region", { name: "Cell inspector" });
	await page.waitForFunction(
		() =>
			document.querySelector('[aria-label="Cell inspector"] pre')?.textContent
				?.length === 131072,
	);
	await inspector.getByRole("button", { name: "Next chunk" }).click();
	await page.waitForFunction(
		() =>
			document.querySelector('[aria-label="Cell inspector"] pre')?.textContent
				?.length === 8928,
	);
	await explorer.getByRole("button", { name: "Schema", exact: true }).click();
	await explorer
		.getByRole("heading", { name: "Foreign keys", exact: true })
		.waitFor();
	assert.match(
		(await explorer.textContent()) ?? "",
		/CREATE TABLE inspector_fixture/,
	);
	await mkdir("build/database-verification", { recursive: true });
	await page.screenshot({
		path: "build/database-verification/schema.png",
		fullPage: true,
	});
	await explorer
		.getByRole("searchbox", { name: "Find table or view" })
		.fill("inspector_composite");
	await explorer
		.getByRole("button", { name: "inspector_composite table", exact: true })
		.click();
	await explorer.getByRole("button", { name: "Rows", exact: true }).click();
	await explorer.getByTitle("Inspect body (text)").click();
	await page.waitForFunction(
		() =>
			document.querySelector('[aria-label="Cell inspector"] pre')?.textContent
				?.length === 65536,
	);
	await page.screenshot({
		path: "build/database-verification/rows.png",
		fullPage: true,
	});
	const download = page.waitForEvent("download");
	await explorer.getByRole("button", { name: "Download OpenAPI" }).click();
	assert.equal((await download).suggestedFilename(), "inferay-openapi.json");
	assert.deepEqual(errors, []);
	console.log(
		"Database browser smoke passed: pagination, literal filtering, exact integers, schema, rowid/composite-key chunks and OpenAPI download.",
	);
} catch (error) {
	const page = browser?.contexts()[0]?.pages()[0];
	if (page) {
		await mkdir("build/database-verification", { recursive: true });
		await page.screenshot({
			path: "build/database-verification/failure.png",
			fullPage: true,
		});
		console.error((await page.locator("body").innerText()).slice(-6000));
	}
	throw error;
} finally {
	await browser?.close();
	server.kill("SIGINT");
	await new Promise<void>((resolve) => {
		if (server.exitCode !== null) resolve();
		else server.once("exit", () => resolve());
	});
	await rm(profile, { recursive: true, force: true });
}
