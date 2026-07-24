import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { handleAppHttpRequest } from "../src/server/app-server.ts";

test("app server serves the compiled renderer and protects local APIs", async () => {
	expect(existsSync("dist/index.html")).toBe(true);
	expect(existsSync("dist/main.js")).toBe(true);

	const origin = "http://127.0.0.1:4001";

	const shellResponse = await request(`${origin}/#/agent`);
	expect(shellResponse.ok).toBe(true);
	expect(shellResponse.headers.get("content-type")).toContain("text/html");
	const cookie = shellResponse.headers.get("set-cookie")?.split(";")[0];
	expect(cookie).toStartWith("inferay_local_auth=");

	const shellHtml = await shellResponse.text();
	expect(shellHtml).toContain('<div id="root"></div>');
	expect(shellHtml).toContain('type="module"');
	expect(shellHtml).toContain("main.js");

	const mainResponse = await request(`${origin}/main.js`);
	expect(mainResponse.ok).toBe(true);
	expect(mainResponse.headers.get("content-type")).toContain(
		"application/javascript"
	);

	const forbiddenResponse = await request(`${origin}/api/app-info`);
	expect(forbiddenResponse.status).toBe(403);

	const appInfoResponse = await request(`${origin}/api/app-info`, cookie);
	expect(appInfoResponse.ok).toBe(true);
	const appInfo = (await appInfoResponse.json()) as { name?: unknown };
	expect(appInfo.name).toBe("inferay");
});

async function request(url: string, cookie?: string): Promise<Response> {
	const response = await handleAppHttpRequest(
		new Request(url, {
			headers: {
				...(cookie ? { Cookie: cookie } : {}),
				Host: "127.0.0.1:4001",
				"Sec-Fetch-Site": "same-origin",
			},
		}),
		undefined,
		{ viteBuildPresent: true }
	);
	if (!response) throw new Error(`No response for ${url}`);
	return response;
}
