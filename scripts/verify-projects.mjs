import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { projectWorkspaceView } from "../src/modules/workspace/model/projectFiles.ts";

const profile = await realpath(
	await mkdtemp(join(tmpdir(), "inferay-project-check-")),
);
const repository = join(profile, "projects", "fixture-repository");
await mkdir(repository, { recursive: true });
const metadata = join(profile, "external-git-metadata");
const git = spawn("git", ["init", "--separate-git-dir", metadata, repository], {
	stdio: "ignore",
});
assert.equal((await once(git, "exit"))[0], 0);
await writeFile(join(repository, "README.md"), "# Preview fixture\n");
for (const args of [
	["add", "README.md"],
	[
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.invalid",
		"commit",
		"-m",
		"Initial preview commit",
	],
]) {
	const command = spawn("git", ["-C", repository, ...args], {
		stdio: "ignore",
	});
	assert.equal((await once(command, "exit"))[0], 0);
}
await writeFile(
	join(repository, "README.md"),
	"# Preview fixture\nChanged locally\n",
);
await writeFile(join(repository, "notes.txt"), "Untracked fixture\n");

const output = join(process.cwd(), "build/project-verification");
await mkdir(output, { recursive: true });
await writeFile(
	join(profile, "settings.json"),
	JSON.stringify({ search_folders: [join(profile, "projects")] }),
);
const server = spawn("target/debug/inferay-dev-server", [], {
	env: {
		...process.env,
		INFERAY_USER_DATA_DIR: profile,
		INFERAY_DEV_BACKEND_ADDR: "127.0.0.1:0",
	},
	stdio: ["ignore", "pipe", "pipe"],
});
const address = await new Promise((resolve, reject) => {
	let log = "";
	const timeout = setTimeout(
		() => reject(new Error("Backend startup timed out: " + log)),
		30000,
	);
	server.on("error", reject);
	server.on("exit", (code) => {
		clearTimeout(timeout);
		reject(new Error("Backend exited: " + code + "\n" + log));
	});
	server.stderr.on("data", (chunk) => {
		log += chunk;
	});
	server.stdout.on("data", (chunk) => {
		log += chunk;
		const match = log.match(/backend: (http:\/\/127\.0\.0\.1:\d+)/);
		if (match) {
			clearTimeout(timeout);
			resolve(match[1]);
		}
	});
}).catch(async (error) => {
	server.kill("SIGINT");
	await rm(profile, { recursive: true, force: true });
	throw error;
});
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on("console", (message) => {
	if (message.type() === "error" && message.text().includes("[renderer]"))
		errors.push(message.text());
});
page.on("pageerror", (e) => errors.push(e.message));
let chatSocket;
const chatSyncs = new Map();
await page.routeWebSocket("**/ws", (socket) => {
	chatSocket = socket;
	const serverSocket = socket.connectToServer();
	serverSocket.onMessage((message) => {
		const data = JSON.parse(String(message));
		if (data.type === "chat:sync") chatSyncs.set(data.paneId, data);
		socket.send(message);
	});
});
try {
	await page.route("**/?inferay-live-reload=*", (route) =>
		route.fulfill({ status: 204, body: "" }),
	);
	await page.goto(address);
	await page
		.getByRole("button", { name: "New project", exact: true })
		.waitFor();
	const expand = page.getByRole("button", {
		name: "Expand workspace sidebar",
		exact: true,
	});
	if (await expand.count()) await expand.click();
	await page.getByRole("navigation", { name: "Project navigation" }).waitFor();
	await page
		.getByRole("button", { name: "Collapse workspace sidebar", exact: true })
		.click();
	await page
		.getByRole("button", { name: "Expand workspace sidebar", exact: true })
		.click();
	await page.getByRole("navigation", { name: "Project navigation" }).waitFor();
	await page.waitForFunction(
		() =>
			document
				.querySelector('aside[aria-label="Workspace sidebar"]')
				?.getBoundingClientRect().width >= 200,
	);
	await page.screenshot({ path: join(output, "projects.png") });
	await page.getByRole("button", { name: "New project", exact: true }).click();
	await page
		.getByRole("dialog", { name: "New project", exact: true })
		.waitFor();
	await page.screenshot({ path: join(output, "create-project.png") });
	await page
		.getByRole("button", { name: "Save project", exact: true })
		.waitFor();
	assert.equal(
		await page
			.getByLabel("Name", { exact: true })
			.evaluate((e) => getComputedStyle(e).borderTopWidth),
		"1px",
	);
	await page.getByLabel("Name", { exact: true }).fill("Brand Lab");
	await page
		.getByLabel("Description", { exact: true })
		.fill("An independent local brand workspace");
	await page
		.getByLabel("Project instructions", { exact: true })
		.fill("Make clear, useful local content. Keep generated tools here.");
	await page.getByRole("button", { name: "Save project", exact: true }).click();
	await page.getByRole("tab", { name: "Brand Lab", exact: true }).waitFor();
	await page
		.getByRole("tablist", { name: "Projects" })
		.getByRole("tab", { name: "Brand Lab", exact: true })
		.waitFor();
	assert.equal(
		await page
			.getByRole("button", { name: "New project chat", exact: true })
			.count(),
		0,
	);
	await page.screenshot({ path: join(output, "overview.png") });
	assert.equal(
		await page
			.getByRole("navigation", { name: "Project navigation" })
			.getByRole("button", { name: "Chats", exact: true })
			.count(),
		0,
	);
	assert.equal(
		await page.getByRole("group", { name: "Repository panels" }).count(),
		0,
	);
	assert.equal(
		await page.getByText("No repository open", { exact: true }).count(),
		0,
	);
	await page.getByRole("button", { name: "New chat", exact: true }).waitFor();
	const navigation = page.getByRole("navigation", {
		name: "Project navigation",
	});
	await navigation
		.getByRole("button", { name: "Repositories", exact: true })
		.click();
	assert.equal(
		await navigation
			.getByRole("button", { name: "Manage repositories", exact: true })
			.count(),
		0,
	);
	await page.getByRole("tab", { name: "Brand Lab", exact: true }).waitFor();
	await navigation
		.getByRole("button", { name: "Repositories", exact: true })
		.click();
	await navigation
		.getByRole("button", { name: "Manage repositories", exact: true })
		.click();
	await page
		.getByRole("dialog", { name: "Edit project", exact: true })
		.waitFor();
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	assert.equal(await page.locator("[data-workspace-explorer]").count(), 0);
	for (const name of ["Plugins"]) {
		await navigation.getByRole("button", { name, exact: true }).click();
		await page
			.getByRole("searchbox", { name: "Search " + name, exact: true })
			.waitFor();
		assert.equal(await page.locator("[data-workspace-explorer]").count(), 0);
	}
	await navigation.getByRole("button", { name: "Memory", exact: true }).click();

	const api = async (path, data) => {
		const response =
			data === undefined
				? await page.request.get(address + path, {
						headers: { origin: address, "sec-fetch-site": "same-origin" },
					})
				: await page.request.post(address + path, {
						data,
						headers: { origin: address, "sec-fetch-site": "same-origin" },
					});
		assert.ok(response.ok(), await response.text());
		const result = await response.json();
		return path.startsWith("/api/projects?") || path === "/api/projects"
			? projectWorkspaceView(result)
			: result;
	};
	const setupCatalog = await api("/api/projects");
	const fixtureProject = setupCatalog.projects.find(
		(project) => project.name === "Brand Lab",
	);
	const reportAutomationId = randomUUID();
	const reportPluginId = randomUUID();
	const videoFixture = (
		await readFile(
			new URL("./tests/fixtures/media/preview.webm", import.meta.url),
		)
	).toString("base64");
	const tableFixture = Buffer.from(
		'Name,Count,Note\n"Research, daily",001,"First line\nSecond line"\n<script>no()</script>,0,Pending\n',
	).toString("base64");
	const reportFiles = {
		"plugin.json": JSON.stringify({
			schema: "inferay.plugin/1",
			id: reportPluginId,
			name: "Report kit",
			version: "1",
			description: "Reusable local report writer",
			may: [],
		}),
		"README.md": "Write a small local report using the report tool.",
		"tools/report/tool.json": JSON.stringify({
			schema: "inferay.tool/1",
			id: randomUUID(),
			name: "Report",
			program: "python3",
			entrypoint: "run.py",
			args: [],
			timeoutSeconds: 30,
			inputSchema: { type: "object" },
			outputSchema: { type: "object" },
		}),
		"tools/report/run.py": `import os,json,base64\nfrom pathlib import Path\nout=Path(os.environ['INFERAY_RUN_OUTPUT'])\n(out/'report.txt').write_text('A local project, a reusable tool, and a durable run.')\n(out/'preview.webm').write_bytes(base64.b64decode('${videoFixture}'))\n(out/'metrics.csv').write_bytes(base64.b64decode('${tableFixture}'))\n(out/'rows.json').write_text(json.dumps([{'name':'Research','count':7},{'name':'Build','count':0}]))\nprint(json.dumps({'artifacts':['report.txt','preview.webm','metrics.csv','rows.json']}))\n`,
		"automations/report.json": JSON.stringify({
			schema: "inferay.automation/1",
			id: reportAutomationId,
			name: "Weekly report example",
			trigger: { kind: "manual" },
			overlap: "skip",
			execution: { kind: "tool", tool: "report", input: {} },
			may: [],
		}),
	};
	await api("/api/projects/command", {
		type: "createPlugin",
		projectId: fixtureProject.id,
		slug: "report-kit",
		files: reportFiles,
	});
	await page.reload();
	await page
		.getByRole("navigation", { name: "Project navigation" })
		.getByRole("button", { name: "Automations", exact: true })
		.click();
	await page
		.getByRole("button", { name: "New automation", exact: true })
		.click();
	await page.getByRole("button", { name: /Project briefing/ }).click();
	assert.equal(
		await page.getByRole("dialog", { name: "Automation" }).count(),
		0,
	);
	await page.getByLabel("Name", { exact: true }).fill("Briefing draft");
	await page
		.getByRole("button", { name: "Reasoning: Low", exact: true })
		.waitFor();
	await page.getByRole("button", { name: /Scheduled · Every week/ }).click();
	await page
		.getByRole("button", { name: "Scheduled · Every day", exact: true })
		.click();
	await page.getByRole("button", { name: /^Model:/ }).click();
	await page
		.getByRole("menu", { name: "Model", exact: true })
		.getByRole("menuitemradio")
		.first()
		.click();
	await page.getByRole("button", { name: /^Reasoning:/ }).click();
	await page
		.getByRole("menu", { name: "Reasoning", exact: true })
		.getByRole("menuitemradio")
		.first()
		.click();
	await page
		.getByRole("textbox", { name: "Instructions", exact: true })
		.focus();
	await page
		.locator('[data-beam="inferay"][data-active="true"]')
		.waitFor({ state: "attached" });
	await page.getByRole("button", { name: "Run time", exact: true }).click();
	await page.getByPlaceholder("Type a time, e.g. 10:15 AM").fill("10:15 AM");
	await page.getByRole("button", { name: /10:15/ }).click();
	await page.screenshot({ path: join(output, "automation-editor.png") });
	await page.getByRole("button", { name: "Create", exact: true }).click();
	await page.getByRole("textbox", { name: "Name", exact: true }).waitFor();
	const savedDraft = await api(
		"/api/projects?projectId=" +
			setupCatalog.projects.find((p) => p.name === "Brand Lab").id,
	);
	assert.equal(
		savedDraft.automations.find((a) => a.name === "Briefing draft").trigger
			.kind,
		"calendar",
	);
	assert.equal(
		savedDraft.automations.find((a) => a.name === "Briefing draft").trigger
			.times[0],
		"10:15",
	);
	assert.ok(
		savedDraft.automations.find((a) => a.name === "Briefing draft").execution
			.reasoningLevel,
	);
	await page.getByRole("button", { name: /Weekly report example/ }).click();
	await page.getByRole("textbox", { name: "Name", exact: true }).waitFor();
	assert.equal(
		await page
			.getByRole("button", { name: "Save changes", exact: true })
			.count(),
		0,
	);
	await page
		.getByRole("textbox", { name: "Name", exact: true })
		.fill("Autosaved weekly report");
	await page.getByRole("button", { name: "Run now", exact: true }).click();
	await page
		.getByRole("button", { name: "Approve & run", exact: true })
		.click();
	await page.getByText("History", { exact: true }).last().waitFor();
	assert.equal(
		await navigation.getByRole("button", { name: "Runs", exact: true }).count(),
		0,
	);
	await page
		.getByText("succeeded", { exact: true })
		.waitFor({ timeout: 15000 });
	await page.getByRole("button", { name: /report.txt ·/ }).click();
	await page
		.getByText("A local project, a reusable tool, and a durable run.", {
			exact: false,
		})
		.last()
		.waitFor();
	await page.screenshot({ path: join(output, "runs.png") });
	await page.getByRole("button", { name: /preview.webm ·/ }).click();
	const video = page.locator("video");
	await video.waitFor();
	await page.waitForFunction(() => {
		const element = document.querySelector("video");
		return element && element.readyState >= 1 && element.duration > 0;
	});
	await video.evaluate(async (element) => {
		element.muted = true;
		await element.play();
	});
	await page.waitForFunction(
		() => document.querySelector("video")?.currentTime > 0.1,
	);
	await video.evaluate((element) => {
		element.pause();
		element.currentTime = 1;
	});
	await page.waitForFunction(() => {
		const element = document.querySelector("video");
		return (
			element && !element.seeking && Math.abs(element.currentTime - 1) < 0.1
		);
	});
	assert.equal(await video.evaluate((element) => element.videoWidth), 160);
	await page.screenshot({ path: join(output, "run-video.png") });
	await page
		.getByRole("button", { name: "Close preview", exact: true })
		.click();
	assert.equal(await video.count(), 0);
	await page.getByRole("button", { name: /metrics.csv ·/ }).click();
	const table = page.getByRole("table", {
		name: "output/metrics.csv",
		exact: true,
	});
	await table.waitFor();
	assert.deepEqual(await table.getByRole("columnheader").allTextContents(), [
		"Name",
		"Count",
		"Note",
	]);
	assert.equal(
		await table.getByRole("cell", { name: "001", exact: true }).count(),
		1,
	);
	assert.equal(
		await table
			.getByRole("cell", { name: "<script>no()</script>", exact: true })
			.count(),
		1,
	);
	assert.equal(await table.locator("script").count(), 0);
	assert.equal(
		await table
			.getByRole("cell", { name: "First line Second line", exact: true })
			.textContent(),
		"First line\nSecond line",
	);
	assert.ok(
		await table.evaluate(
			(element) =>
				element.getBoundingClientRect().width >
				element.closest("section").getBoundingClientRect().width * 0.9,
		),
	);
	await page.screenshot({ path: join(output, "run-table.png") });
	await page.getByRole("button", { name: "View source", exact: true }).click();
	assert.equal(await table.count(), 0);
	assert.ok(
		(
			await page
				.getByRole("region", { name: "Run output preview" })
				.locator("pre")
				.textContent()
		).includes('"Research, daily",001'),
	);
	await page.getByRole("button", { name: "View table", exact: true }).click();
	await table.waitFor();
	await page.getByRole("button", { name: /rows.json ·/ }).click();
	const jsonTable = page.getByRole("table", {
		name: "output/rows.json",
		exact: true,
	});
	await jsonTable.waitFor();
	assert.equal(
		await jsonTable.getByRole("cell", { name: "Build", exact: true }).count(),
		1,
	);
	assert.equal(
		await jsonTable.getByRole("cell", { name: "0", exact: true }).count(),
		1,
	);
	await page
		.getByRole("button", { name: "Close preview", exact: true })
		.click();

	// Memory import/graph verification remains a separate gate. These retired
	// brand forms have no corresponding page in the current interface.
	await navigation.getByRole("button", { name: "Memory", exact: true }).click();
	await page.screenshot({ path: join(output, "memory.png") });
	await page.getByRole("button", { name: "New chat", exact: true }).click();
	await page.getByRole("textbox", { name: "Message input" }).waitFor();
	assert.equal(
		await page
			.getByText("Select a commit to view details", { exact: true })
			.count(),
		0,
	);
	await page.screenshot({ path: join(output, "chat.png") });
	const cardCatalog = await api("/api/projects");
	const cardProject = cardCatalog.projects.find((p) => p.name === "Brand Lab");
	const cardPane = await page
		.locator("[data-chat-pane-id]")
		.first()
		.getAttribute("data-chat-pane-id");
	const proposalAutomationId = randomUUID();
	const proposalPluginId = randomUUID();
	const chatReportId = randomUUID();
	const proposalDefinition = {
		schema: "inferay.automation/1",
		id: proposalAutomationId,
		name: "Chat briefing",
		trigger: {
			kind: "calendar",
			timezone: "America/Chicago",
			days: [1],
			times: ["09:00"],
		},
		overlap: "skip",
		may: [],
		execution: {
			kind: "agent",
			provider: "codex",
			model: null,
			reasoningLevel: "medium",
			instructions: "Prepare a weekly briefing.\n".repeat(100),
			skills: [],
			resources: [],
			repositories: [],
			tools: [],
			workingDirectory: { base: "project", path: "." },
			timeoutSeconds: 300,
		},
	};
	const proposal = {
		type: "createPlugin",
		projectId: cardProject.id,
		slug: "briefing-kit",
		files: {
			"plugin.json": JSON.stringify({
				schema: "inferay.plugin/1",
				id: proposalPluginId,
				name: "Briefing kit",
				version: "1",
				description: "Reusable project briefing",
				may: [],
			}),
			"README.md": "Reusable briefing instructions and a weekly schedule.",
			"automations/weekly.json": JSON.stringify(proposalDefinition),
			"tools/report/tool.json": JSON.stringify({
				...JSON.parse(reportFiles["tools/report/tool.json"]),
				id: randomUUID(),
			}),
			"tools/report/run.py": reportFiles["tools/report/run.py"],
			"automations/report.json": JSON.stringify({
				...JSON.parse(reportFiles["automations/report.json"]),
				id: chatReportId,
				name: "Chat-created report",
			}),
		},
	};
	const sendCard = () =>
		chatSocket.send(
			JSON.stringify({
				type: "chat:sync",
				modelVersion: 1,
				paneId: cardPane,
				unchanged: false,
				epoch: chatSyncs.get(cardPane)?.epoch,
				revision: (chatSyncs.get(cardPane)?.revision ?? 0) + 1,
				isStreaming: false,
				checkpoints: [],
				pendingSteers: [],
				messages: [
					{
						id: "automation-card-fixture",
						role: "system",
						content: JSON.stringify({
							type: "inferay.plugin-proposal",
							command: proposal,
						}),
						render: {
							version: 1,
							kind: "message",
							pluginProposal: proposal,
						},
					},
				],
			}),
		);
	sendCard();
	const card = page.getByRole("region", { name: "Plugin proposal" });
	await card.getByRole("button", { name: "Save plugin", exact: true }).click();
	await card.getByText("Saved in project", { exact: true }).waitFor();
	const savedCardCatalog = await api(
		`/api/projects?projectId=${cardProject.id}`,
	);
	assert.equal(
		savedCardCatalog.plugins.filter(
			(plugin) => plugin.file.id === proposalPluginId,
		).length,
		1,
	);
	const savedAutomation = savedCardCatalog.automations.find(
		(automation) => automation.id === proposalAutomationId,
	);
	assert.equal(savedAutomation.execution.reasoningLevel, "medium");
	assert.equal(savedAutomation.enabled, false);
	await page.screenshot({ path: join(output, "plugin-chat-card.png") });
	const review = page.getByRole("dialog", {
		name: "Review Briefing kit",
		exact: true,
	});
	assert.equal(
		await review
			.getByRole("switch", { name: "Enable schedules after approval" })
			.getAttribute("aria-checked"),
		"false",
	);
	await review
		.getByRole("switch", { name: "Enable schedules after approval" })
		.click();
	await review
		.getByRole("button", { name: "Approve & enable", exact: true })
		.click();
	await review.waitFor({ state: "hidden" });
	const approvedCatalog = await api(
		`/api/projects?projectId=${cardProject.id}`,
	);
	assert.ok(
		approvedCatalog.plugins.find(
			(plugin) => plugin.file.id === proposalPluginId,
		).approvedHash,
	);
	assert.equal(
		approvedCatalog.automations.find(
			(automation) => automation.id === proposalAutomationId,
		).enabled,
		true,
	);
	await navigation
		.getByRole("button", { name: "Automations", exact: true })
		.click();
	await page
		.getByRole("button", { name: "History", exact: true })
		.first()
		.click();
	const upcoming = page.getByRole("region", {
		name: "Upcoming automations",
		exact: true,
	});
	await upcoming
		.getByRole("button", { name: "Chat briefing", exact: true })
		.waitFor();
	assert.equal(
		await upcoming.locator("time").getAttribute("datetime"),
		new Date(
			approvedCatalog.automations.find(
				(automation) => automation.id === proposalAutomationId,
			).nextDueAt,
		).toISOString(),
	);
	await page.screenshot({ path: join(output, "upcoming-automations.png") });
	await upcoming
		.getByRole("button", { name: "Chat briefing", exact: true })
		.click();
	await page.getByRole("textbox", { name: "Name", exact: true }).waitFor();
	await page.getByRole("button", { name: /Chat-created report/ }).click();
	await page.getByRole("button", { name: "Run now", exact: true }).click();

	await page
		.getByText("succeeded", { exact: true })
		.waitFor({ timeout: 15000 });
	await page.getByRole("button", { name: /report.txt ·/ }).click();
	await page
		.getByRole("region", { name: "Run output preview" })
		.getByText("A local project, a reusable tool, and a durable run.", {
			exact: false,
		})
		.waitFor();
	const executedCatalog = await api(
		`/api/projects?projectId=${cardProject.id}`,
	);
	const executed = executedCatalog.runs.filter(
		(run) => run.automationId === chatReportId,
	);
	assert.equal(executed.length, 1);
	assert.equal(executed[0].status, "succeeded");
	await page.screenshot({ path: join(output, "chat-plugin-run.png") });
	await writeFile(
		join(profile, "projects", cardProject.id, "plugins/briefing-kit/README.md"),
		"Changed library instructions require a new review.\n",
	);
	const changedCatalog = await api(`/api/projects?projectId=${cardProject.id}`);
	assert.equal(
		changedCatalog.automations.find(
			(automation) => automation.id === proposalAutomationId,
		).enabled,
		false,
	);
	assert.equal(
		changedCatalog.automations.find(
			(automation) => automation.id === proposalAutomationId,
		).inputsChanged,
		true,
	);
	assert.equal(
		changedCatalog.plugins.find((plugin) => plugin.file.id === proposalPluginId)
			.approvedHash,
		null,
	);
	await page.getByRole("button", { name: /Chat-created report/ }).click();
	await page.getByRole("button", { name: "Run now", exact: true }).click();
	const changedReview = page.getByRole("dialog", {
		name: "Run automation",
		exact: true,
	});
	await changedReview
		.getByRole("button", { name: "Approve & run", exact: true })
		.waitFor();
	await page.keyboard.press("Escape");
	await changedReview.waitFor({ state: "hidden" });
	const afterRefusedRun = await api(
		`/api/projects?projectId=${cardProject.id}`,
	);
	assert.equal(
		afterRefusedRun.runs.filter((run) => run.automationId === chatReportId)
			.length,
		1,
		"Changed inputs must not launch another run without approval",
	);
	await writeFile(
		join(
			profile,
			"projects",
			cardProject.id,
			"plugins/briefing-kit/plugin.json",
		),
		"{broken manifest",
	);
	await page.reload();
	await navigation
		.getByRole("button", { name: "Plugins", exact: true })
		.click();
	const brokenLibrary = page
		.getByRole("article")
		.filter({ hasText: "briefing-kit" });
	await brokenLibrary.getByText("Needs repair", { exact: true }).waitFor();
	await brokenLibrary
		.getByRole("button", { name: "Open library", exact: true })
		.click();
	const libraryDialog = page.getByRole("dialog");
	await libraryDialog
		.getByRole("button", { name: "Edit file", exact: true })
		.click();
	const manifestEditor = libraryDialog.getByRole("textbox", {
		name: "Edit plugin.json",
		exact: true,
	});
	await manifestEditor.fill(proposal.files["plugin.json"]);
	await page.keyboard.press("Escape");
	assert.equal(
		await manifestEditor.count(),
		1,
		"Escape must preserve unsaved library edits",
	);
	await page.mouse.click(4, 200);
	assert.equal(
		await manifestEditor.count(),
		1,
		"Backdrop dismissal must preserve unsaved library edits",
	);
	await libraryDialog
		.getByRole("button", { name: "Save file", exact: true })
		.click();
	await libraryDialog
		.getByText("File saved. Review changed inputs before enabling schedules.", {
			exact: true,
		})
		.waitFor();
	await page.keyboard.press("Escape");
	await libraryDialog.waitFor({ state: "hidden" });
	const repaired = await api(`/api/projects?projectId=${cardProject.id}`);
	const repairedPlugin = repaired.plugins.find(
		(plugin) => plugin.file.id === proposalPluginId,
	);
	assert.equal(repairedPlugin.file.error, null);
	assert.equal(
		repairedPlugin.approvedHash,
		null,
		"Repair must not restore execution approval",
	);
	assert.equal(
		repaired.automations.find(
			(automation) => automation.id === proposalAutomationId,
		).enabled,
		false,
	);
	const runId = "run-chat-fixture";
	const runDirectory = join(profile, "projects", cardProject.id, "runs", runId);
	await mkdir(join(runDirectory, "logs"), { recursive: true });
	await writeFile(
		join(runDirectory, "logs", "agent.jsonl"),
		JSON.stringify({ providerSessionId: "fixture-provider-session" }) +
			"\n" +
			JSON.stringify({
				type: "result",
				result: "Found three actionable improvements.",
			}) +
			"\n",
	);
	const seedRun = spawn(
		"python3",
		[
			"-c",
			"import sqlite3,sys,json; db=sqlite3.connect(sys.argv[1]); db.execute(\"INSERT INTO runs(id,project_id,automation_id,name,request_key,status,snapshot,input_hash,requested_at,result) VALUES(?,?,?,?,?,'succeeded',?,'fixture',1,?)\",(sys.argv[2],sys.argv[3],sys.argv[4],'Research result','fixture-run',sys.argv[5],json.dumps({'message':'Found three actionable improvements.'}))); db.execute(\"INSERT INTO run_events(run_id,sequence,kind,payload,created_at) VALUES(?,1,'provider_usage',?,1)\", (sys.argv[2],json.dumps({'provider':'claude','usage':{'input_tokens':100,'output_tokens':20,'cache_read_input_tokens':50},'reportedCostUsd':0.0123}))); db.commit()",
			join(profile, "projects.sqlite3"),
			runId,
			cardProject.id,
			proposalAutomationId,
			JSON.stringify({
				automation: proposalDefinition,
				execution: proposalDefinition.execution,
				projectId: cardProject.id,
			}),
		],
		{ stdio: "inherit" },
	);
	assert.equal((await once(seedRun, "exit"))[0], 0);
	// Display fixture: provider reporting is covered by real native runtime gates.
	await navigation
		.getByRole("button", { name: "Automations", exact: true })
		.click();
	await page.getByRole("button", { name: /Chat briefing/ }).click();
	await page
		.getByRole("button", { name: "History", exact: true })
		.last()
		.click();
	const usageRow = page.getByLabel("Provider usage");
	await usageRow.getByText("150 input tokens", { exact: true }).waitFor();
	await usageRow.getByText("20 output tokens", { exact: true }).waitFor();
	await usageRow.getByText("50 cached input", { exact: true }).waitFor();
	await usageRow.getByText(/0.0123.*reported cost/).waitFor();
	await page.screenshot({ path: join(output, "run-usage.png") });
	await page
		.getByRole("button", { name: "History", exact: true })
		.first()
		.click();
	await page
		.getByRole("article")
		.filter({ hasText: "Autosaved weekly report" })
		.waitFor();
	await page
		.getByRole("article")
		.filter({ hasText: "Research result" })
		.waitFor();

	const imported = await api("/api/projects/run-chat", { id: runId });
	const reopened = await api("/api/projects/run-chat", { id: runId });
	assert.equal(
		imported.paneId,
		reopened.paneId,
		"Opening a run twice should select the same chat",
	);
	const importedState = await api("/api/agent/state");
	assert.ok(
		importedState.groups.some((g) =>
			g.panes.some((p) => p.id === imported.paneId),
		),
	);
	await api("/api/agent/state/workspace-action", {
		action: {
			type: "removePane",
			groupId: importedState.groups.find((g) =>
				g.panes.some((p) => p.id === imported.paneId),
			).id,
			paneId: imported.paneId,
		},
	});
	const projectNav = page.getByRole("navigation", {
		name: "Project navigation",
	});
	assert.equal(
		await page.getByRole("tab", { name: "All projects", exact: true }).count(),
		0,
	);
	await page.getByRole("button", { name: "New project", exact: true }).click();
	await page.getByLabel("Name", { exact: true }).fill("Second project");
	await page.getByRole("button", { name: "Save project", exact: true }).click();
	await page
		.getByRole("tab", { name: "Second project", exact: true })
		.waitFor();
	await page.getByRole("tab", { name: "Brand Lab", exact: true }).click();
	await page.getByRole("tab", { name: "Brand Lab", exact: true }).waitFor();
	await page.reload();
	await page.getByRole("tab", { name: "Brand Lab", exact: true }).waitFor();
	await page
		.getByRole("button", { name: "Collapse workspace sidebar", exact: true })
		.click();
	await page
		.getByRole("button", { name: "Expand workspace sidebar", exact: true })
		.click();
	await page
		.getByRole("tablist", { name: "Projects" })
		.getByRole("tab", { name: "Brand Lab", exact: true })
		.waitFor();
	const catalog = await api("/api/projects");
	const brand = catalog.projects.find((p) => p.name === "Brand Lab");
	const repositoryId = randomUUID();
	await api("/api/projects/command", {
		type: "saveDefinition",
		projectId: brand.id,
		path: "project.json",
		expectedHash: brand.file.sourceHash,
		content: JSON.stringify({
			...brand.file.definition,
			repositories: [
				...brand.repositories,
				{ id: repositoryId, name: "fixture-repository" },
			],
		}),
	});
	const declaredBrand = (await api("/api/projects")).projects.find(
		(p) => p.id === brand.id,
	);
	await api("/api/projects/command", {
		type: "linkRepository",
		projectId: brand.id,
		repositoryId,
		expectedProjectHash: declaredBrand.file.sourceHash,
		path: repository,
	});
	const gitReviewId = randomUUID();
	await api("/api/projects/command", {
		type: "saveDefinition",
		projectId: brand.id,
		path: `automations/${gitReviewId}/automation.json`,
		expectedHash: null,
		content: JSON.stringify({
			schema: "inferay.automation/1",
			id: gitReviewId,
			name: "Git metadata review",
			trigger: { kind: "interval", seconds: 86400 },
			overlap: "skip",
			may: ["write_repositories", "commit"],
			execution: {
				kind: "agent",
				provider: "codex",
				instructions: "Review fixture only",
				skills: [],
				resources: [],
				repositories: [repositoryId],
				workingDirectory: { base: "repository", id: repositoryId },
				timeoutSeconds: 30,
			},
		}),
	});
	const gitReview = await api("/api/projects/command", {
		type: "reviewAutomation",
		id: gitReviewId,
	});
	assert.deepEqual(gitReview.gitWritePaths, [await realpath(metadata)]);
	await page.reload();
	await page.getByRole("tab", { name: "Brand Lab", exact: true }).click();
	await page.getByRole("button", { name: "Automations", exact: true }).click();
	await page
		.getByRole("switch", { name: "Enable Git metadata review", exact: true })
		.click();
	const gitApproval = page.getByRole("dialog", {
		name: "Enable automation",
		exact: true,
	});
	await gitApproval
		.getByRole("region", { name: "Git metadata write access", exact: true })
		.getByText(await realpath(metadata), { exact: true })
		.waitFor();
	await page.screenshot({ path: join(output, "git-metadata-approval.png") });
	await page.keyboard.press("Escape");
	await gitApproval.waitFor({ state: "hidden" });
	assert.equal(
		(await api(`/api/projects?projectId=${brand.id}`)).automations.find(
			(a) => a.id === gitReviewId,
		).enabled,
		false,
	);
	const conversationLabel = await page
		.getByRole("button", { name: /^Delete / })
		.first()
		.getAttribute("aria-label");
	await page
		.getByRole("button", {
			name: conversationLabel.slice("Delete ".length),
			exact: true,
		})
		.click();
	const repositoryButton = page.getByRole("button", {
		name: "Open repository fixture-repository",
		exact: true,
	});
	await repositoryButton.waitFor();
	await repositoryButton.getByText("+1", { exact: true }).waitFor();
	await repositoryButton.getByText("-0", { exact: true }).waitFor();
	await page.screenshot({ path: join(output, "repository-sidebar.png") });

	const conversationsBeforeRepository = await page
		.getByRole("button", { name: /^Delete / })
		.count();

	assert.equal(
		await page.getByRole("textbox", { name: "Message input" }).count(),
		1,
	);
	await page
		.getByRole("button", {
			name: "Open repository fixture-repository",
			exact: true,
		})
		.click();
	await page.getByRole("group", { name: "Repository panels" }).waitFor();
	await page.getByRole("region", { name: "Repository workspace" }).waitFor();
	assert.equal(await page.locator("[data-workspace-explorer]").count(), 0);
	assert.equal(
		await page.getByRole("button", { name: "Git graph", exact: true }).count(),
		0,
	);
	assert.equal(
		await page.getByRole("textbox", { name: "Message input" }).count(),
		0,
	);
	assert.equal(
		await page.getByRole("button", { name: /^Delete / }).count(),
		conversationsBeforeRepository,
	);
	await page
		.getByText("Initial preview commit", { exact: true })
		.first()
		.waitFor();
	await page.screenshot({ path: join(output, "repository-workspace.png") });

	const conversationCount = await page
		.getByRole("button", { name: /^Delete / })
		.count();
	await projectNav.getByRole("button", { name: "Memory", exact: true }).click();
	assert.equal(
		await page.getByRole("textbox", { name: "Message input" }).count(),
		0,
	);
	assert.equal(
		await page.getByRole("group", { name: "Repository panels" }).count(),
		0,
	);
	await page
		.getByRole("button", {
			name: "Open repository fixture-repository",
			exact: true,
		})
		.click();
	await page.getByRole("group", { name: "Repository panels" }).waitFor();
	assert.equal(
		await page.getByRole("button", { name: /^Delete / }).count(),
		conversationCount,
	);
	await projectNav.getByRole("button", { name: "Memory", exact: true }).click();
	await page.getByRole("tab", { name: "Brand Lab", exact: true }).waitFor();
	await page.getByRole("button", { name: "New project", exact: true }).click();
	await page.getByLabel("Name", { exact: true }).fill("Aivre");
	assert.equal(
		await page
			.getByRole("dialog", { name: "New project" })
			.getByRole("checkbox")
			.count(),
		0,
	);
	await page.getByPlaceholder("Search folder...").fill("fixture-repository");
	await page
		.getByRole("dialog", { name: "New project" })
		.getByRole("button", { name: /fixture-repository/ })
		.first()
		.click();
	await page.screenshot({ path: join(output, "new-project-repositories.png") });
	await page.getByRole("button", { name: "Save project", exact: true }).click();
	await page.getByRole("tab", { name: "Aivre", exact: true }).waitFor();

	await page
		.getByRole("button", {
			name: "Open repository fixture-repository",
			exact: true,
		})
		.waitFor();
	await page.getByRole("button", { name: "New chat", exact: true }).click();
	await page.getByRole("textbox", { name: "Message input" }).waitFor();
	assert.equal(
		await page.getByRole("group", { name: "Repository panels" }).count(),
		0,
	);
	const currentCatalog = await api("/api/projects");
	const aivre = currentCatalog.projects.find((p) => p.name === "Aivre");
	let state = await api("/api/agent/state");
	const groupId = state.selectedGroupId;
	for (const cwd of [repository, profile, repository]) {
		const response = await api("/api/agent/state/workspace-action", {
			action: { type: "addPane", groupId, agentKind: "codex", cwd },
		});
		state = response.state;
		const paneId = state.groups.find((g) => g.id === groupId).selectedPaneId;
		await api("/api/projects/command", {
			type: "associateConversation",
			projectId: aivre.id,
			paneId,
		});
	}
	await api("/api/agent/state/workspace-action", {
		action: { type: "setGridDimensions", groupId, columns: 2, rows: 2 },
	});
	await page.reload();
	const sidebar = page.getByRole("complementary", {
		name: "Workspace sidebar",
	});
	await sidebar
		.getByRole("button", { name: "fixture-repository", exact: true })
		.first()
		.click();
	await page.getByRole("button", { name: "Grid layout", exact: true }).click();
	await page.getByRole("button", { name: "Grid layout", exact: true }).click();
	const cells = page.locator(
		"[data-agent-grid-pane-id]:has([data-chat-pane-id])",
	);
	await page.waitForFunction(
		() => document.querySelectorAll("[data-chat-pane-id]").length === 4,
	);
	assert.equal(
		await page.getByRole("textbox", { name: "Message input" }).count(),
		4,
	);
	assert.equal(await page.locator("[data-workspace-explorer]").count(), 0);
	const idsBefore = await cells.evaluateAll((els) =>
		els.map((e) => e.dataset.agentGridPaneId),
	);
	await sidebar
		.getByRole("button", { name: "New conversation", exact: true })
		.click();
	assert.deepEqual(
		await cells.evaluateAll((els) => els.map((e) => e.dataset.agentGridPaneId)),
		idsBefore,
	);
	await page.screenshot({ path: join(output, "conversation-grid.png") });
	await sidebar
		.getByRole("button", { name: /^Delete / })
		.first()
		.click();
	await page.waitForFunction(
		() => document.querySelectorAll("[data-chat-pane-id]").length === 3,
	);
	assert.equal(
		await page
			.getByText("Workspace couldn’t be displayed.", { exact: true })
			.count(),
		0,
	);
	const remaining = await cells.evaluateAll((els) =>
		els.map((e) => ({
			id: e.dataset.agentGridPaneId,
			x: e.getBoundingClientRect().x,
			y: e.getBoundingClientRect().y,
			width: e.getBoundingClientRect().width,
		})),
	);
	assert.deepEqual(
		remaining.map((p) => p.id),
		idsBefore.slice(1),
	);
	assert.ok(
		Math.abs(remaining[0].y - remaining[1].y) < 2,
		"remaining first row aligns",
	);
	assert.ok(
		Math.abs(remaining[0].width - remaining[1].width) < 2,
		"remaining cells have equal width",
	);
	await page.screenshot({
		path: join(output, "conversation-grid-after-delete.png"),
	});
	await projectNav.getByRole("button", { name: "Memory", exact: true }).click();
	await page.getByRole("tab", { name: "Aivre", exact: true }).waitFor();

	assert.equal(
		await projectNav
			.getByRole("button", { name: "Overview", exact: true })
			.count(),
		0,
	);
	const projectTabs = page.getByRole("tablist", { name: "Projects" });
	const initialOrder = await projectTabs.getByRole("tab").allTextContents();
	await projectTabs.getByRole("tab", { name: "Aivre", exact: true }).dragTo(
		projectTabs.getByRole("tab", {
			name: initialOrder[0].trim(),
			exact: true,
		}),
		{ targetPosition: { x: 2, y: 12 } },
	);
	const reordered = await projectTabs.getByRole("tab").allTextContents();
	assert.equal(reordered[0].trim(), "Aivre");
	await page.reload();
	await projectTabs.getByRole("tab", { name: "Aivre", exact: true }).waitFor();
	assert.deepEqual(
		await projectTabs.getByRole("tab").allTextContents(),
		reordered,
	);
	await projectTabs
		.getByRole("tab", { name: "Second project", exact: true })
		.click();
	await page.getByRole("button", { name: "Edit project", exact: true }).click();
	const editor = page.getByRole("dialog", {
		name: "Edit project",
		exact: true,
	});
	await editor
		.getByRole("button", { name: "Archive project", exact: true })
		.click();
	const confirmArchive = editor.getByRole("button", {
		name: "Confirm archive",
		exact: true,
	});
	assert.equal(await confirmArchive.isDisabled(), true);
	await editor
		.getByRole("textbox", { name: "Project name to confirm archive" })
		.fill("Second project");
	await confirmArchive.click();
	await editor.waitFor({ state: "hidden" });
	assert.equal(
		await projectTabs
			.getByRole("tab", { name: "Second project", exact: true })
			.count(),
		0,
	);
	const archived = await api("/api/projects");
	assert.equal(
		archived.projects.find((p) => p.name === "Second project").archived,
		true,
	);
	await navigation
		.getByRole("button", { name: "Automations", exact: true })
		.click();
	await projectTabs
		.getByRole("tab", { name: "Brand Lab", exact: true })
		.click();
	await page
		.getByRole("searchbox", { name: "Search Automations", exact: true })
		.waitFor();
	await page.getByRole("button", { name: /Briefing draft/ }).click();
	await page.getByRole("button", { name: "Delete…", exact: true }).click();
	const removal = page.getByRole("dialog", {
		name: "Delete automation",
		exact: true,
	});
	await removal.getByRole("button", { name: "Cancel", exact: true }).click();
	await page.getByRole("button", { name: "Delete…", exact: true }).click();
	await removal
		.getByRole("button", { name: "Delete automation", exact: true })
		.click();
	await removal.waitFor({ state: "hidden" });
	const removedCatalog = await api(
		"/api/projects?projectId=" +
			setupCatalog.projects.find((p) => p.name === "Brand Lab").id,
	);
	assert.equal(
		removedCatalog.automations.find((a) => a.name === "Briefing draft")
			.archived,
		true,
	);
	assert.equal(
		removedCatalog.automations.find((a) => a.name === "Briefing draft").enabled,
		false,
	);
	await page.setViewportSize({ width: 1000, height: 720 });
	await page.screenshot({ path: join(output, "compact-overview.png") });
	assert.deepEqual(errors, []);
	console.log(
		"PASS: project tabs and creation, repository membership, sidebar Git totals, standalone graph without new chats, conversation grid and first-pane deletion, automation and artifact flow with video playback/seeking and structured tables, chat plugin approval/revocation, manifest repair and unsaved-edit protection.",
	);
} catch (e) {
	console.log("BODY:", (await page.locator("body").innerText()).slice(0, 5000));
	console.log("ERRORS:", errors);
	await page.screenshot({ path: join(output, "failure.png") });
	throw e;
} finally {
	await browser.close();
	server.kill("SIGINT");
	await once(server, "exit");
	await rm(profile, { recursive: true, force: true });
}
