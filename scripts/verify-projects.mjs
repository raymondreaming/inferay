import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const profile = await realpath(
	await mkdtemp(join(tmpdir(), "inferay-project-check-")),
);
const repository = join(profile, "projects", "fixture-repository");
await mkdir(repository, { recursive: true });
const git = spawn("git", ["init", repository], { stdio: "ignore" });
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
	for (const name of ["Files", "Tools", "Plugins"]) {
		await navigation.getByRole("button", { name, exact: true }).click();
		await page
			.getByRole("searchbox", { name: "Search " + name, exact: true })
			.waitFor();
		assert.equal(await page.locator("[data-workspace-explorer]").count(), 0);
	}
	await navigation
		.getByRole("button", { name: "Resources", exact: true })
		.click();

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
		return response.json();
	};
	const setupCatalog = await api("/api/projects");
	await api("/api/projects/command", {
		type: "createExample",
		projectId: setupCatalog.projects.find((p) => p.name === "Brand Lab").id,
	});
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
		savedDraft.automations.find((a) => a.name === "Briefing draft")
			.intervalSeconds,
		86400,
	);
	assert.equal(
		savedDraft.automations.find((a) => a.name === "Briefing draft").calendar
			.time,
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
	await page
		.getByRole("navigation", { name: "Project navigation" })
		.getByRole("button", { name: "Resources", exact: true })
		.click();
	await page.getByRole("button", { name: "Add resource", exact: true }).click();
	await page.getByLabel("Name", { exact: true }).fill("Northstar");
	await page
		.getByLabel("Purpose", { exact: true })
		.fill("Practical design for independent teams");
	await page.getByLabel("Voice", { exact: true }).fill("Clear and direct");
	await page
		.getByRole("button", { name: "Save resource", exact: true })
		.click();
	await page.getByText("Northstar", { exact: true }).waitFor();
	await page.getByRole("button", { name: "Add resource", exact: true }).click();
	await page
		.getByRole("button", { name: "Resource type", exact: true })
		.click();
	await page.getByRole("button", { name: "brand.mind", exact: true }).click();
	await page.getByLabel("Name", { exact: true }).fill("Northstar Mind");
	await page
		.getByLabel("Instructions and knowledge", { exact: true })
		.fill("Every brief should state the audience and a single next action.");
	await page
		.getByRole("button", { name: "Save resource", exact: true })
		.click();
	await page.getByText("Northstar Mind", { exact: true }).waitFor();
	await page.screenshot({ path: join(output, "resources.png") });
	await page.getByRole("button", { name: "Resources", exact: true }).click();
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
	const proposal = {
		type: "saveAutomation",
		id: "chat-proposal-fixture",
		projectId: cardProject.id,
		expectedRevision: null,
		name: "Chat briefing",
		execution: {
			kind: "agent",
			instructions: "Prepare a weekly briefing.\n".repeat(100),
			provider: "codex",
			model: null,
			reasoningLevel: "medium",
			skillIds: [],
			resourceIds: [],
			workingDirectory: { base: "project", path: "." },
			timeoutSeconds: 300,
		},
		intervalSeconds: 604800,
		overlapPolicy: "skip",
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
							type: "inferay.automation-proposal",
							command: proposal,
						}),
						render: {
							version: 1,
							kind: "message",
							automationProposal: proposal,
						},
					},
				],
			}),
		);
	sendCard();
	const card = page.getByRole("region", { name: "Automation proposal" });
	await card
		.getByRole("button", { name: "Accept & save", exact: true })
		.click();
	await card
		.getByText("Project automation · Saved, schedule off", { exact: true })
		.waitFor();
	await card
		.getByRole("switch", { name: "Enable automation", exact: true })
		.click();
	await card
		.getByText("Project automation · Schedule enabled", { exact: true })
		.waitFor();
	await card
		.getByRole("switch", { name: "Enable automation", exact: true })
		.click();
	await card.getByRole("button", { name: "Edit", exact: true }).click();
	const cardDialog = page.getByRole("dialog", { name: "Edit automation" });
	await cardDialog
		.getByRole("textbox", { name: "Name", exact: true })
		.fill("Edited chat briefing");
	await cardDialog
		.getByRole("button", { name: "Save changes", exact: true })
		.click();
	await card.getByText("Edited chat briefing", { exact: true }).waitFor();
	await card
		.getByRole("button", { name: "View instructions", exact: true })
		.click();
	assert.ok(
		(await card.boundingBox()).height < 500,
		"Expanded instructions must keep the card compact",
	);
	await card.getByRole("button", { name: "Run now", exact: true }).waitFor();
	const savedCardCatalog = await api(
		`/api/projects?projectId=${cardProject.id}`,
	);
	assert.equal(
		savedCardCatalog.automations.filter((a) => a.id === proposal.id).length,
		1,
	);
	assert.equal(
		savedCardCatalog.automations.find((a) => a.id === proposal.id).execution
			.reasoningLevel,
		"medium",
	);
	await page.screenshot({ path: join(output, "automation-chat-card.png") });

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
			"import sqlite3,sys,json; db=sqlite3.connect(sys.argv[1]); db.execute(\"INSERT INTO runs(id,project_id,automation_id,name,request_key,status,snapshot,input_hash,requested_at,result) VALUES(?,?,?,?,?,'succeeded',?,'fixture',1,?)\",(sys.argv[2],sys.argv[3],sys.argv[4],'Research result','fixture-run',sys.argv[5],json.dumps({'message':'Found three actionable improvements.'}))); db.commit()",
			join(profile, "projects.sqlite3"),
			runId,
			cardProject.id,
			proposal.id,
			JSON.stringify({ execution: proposal.execution }),
		],
		{ stdio: "inherit" },
	);
	assert.equal((await once(seedRun, "exit"))[0], 0);
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
	await api("/api/projects/command", {
		type: "saveResource",
		id: null,
		expectedRevision: null,
		projectId: brand.id,
		typeId: "inferay.repository",
		name: "Fixture repository",
		schemaVersion: 1,
		body: {
			location: { base: "external", path: repository },
			instructions: "",
		},
	});
	await page.reload();
	await page.getByRole("tab", { name: "Brand Lab", exact: true }).click();
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
	await projectNav
		.getByRole("button", { name: "Resources", exact: true })
		.click();
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
	await projectNav
		.getByRole("button", { name: "Resources", exact: true })
		.click();
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
	await projectNav
		.getByRole("button", { name: "Resources", exact: true })
		.click();
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
		"PASS: project tabs and creation, repository membership, sidebar Git totals, standalone graph without new chats, conversation grid and first-pane deletion, automation and artifact flow.",
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
