import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as signals from "@solidjs/signals";
import { DocumentReplica } from "../../src/shared/lib/native.tsx";

// Run the production lifecycle with real Solid signals and the native model.
// File I/O and persistence are the only substituted boundaries.
test("saving tab state does not replay an old open request", async () => {
	const source = readFileSync(
		new URL(
			"../../src/modules/repository/components/documents/components/DocumentViewer/index.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const code = new Bun.Transpiler({ loader: "ts" }).transformSync(
		source.slice(source.indexOf("function useDocumentSession(")),
	);
	const reads: string[] = [];
	const file = (path: string) => ({ path, cwd: "/repo", content: path });
	let replaceSession = () => {};
	const dependencies = {
		...signals,
		DocumentReplica,
		sessions: new Map(),
		restoreDocumentSession: async () => ({
			files: [file("a"), file("b")],
			activePath: "b",
		}),
		loadFileContent: async (_cwd: string, path: string) => {
			reads.push(path);
			return file(path);
		},
	};
	const mount = new Function(
		...Object.keys(dependencies),
		`${code}; return useDocumentSession;`,
	)(...Object.values(dependencies));
	let dispose = () => {};
	let setRequest!: (value: { path: string; token: number }) => void;
	let viewer!: {
		activePath: () => string | null;
		openFiles: () => { path: string }[];
		selectFile: (path: string) => void;
		closeFile: (path: string) => void;
	};
	signals.createRoot((cleanup) => {
		dispose = cleanup;
		const [session, setSession] = signals.createSignal({
			request: { path: "b", token: 1 },
		});
		replaceSession = () =>
			setSession((current) => ({ request: { ...current.request } }));
		setRequest = (request) => setSession({ request });
		viewer = mount({
			workspaceId: "repo",
			cwd: "/repo",
			onClose: () => {},
			get openRequest() {
				return session().request;
			},
			onSessionChange: replaceSession,
		});
	});
	const settle = async () => {
		for (let i = 0; i < 5; i++) {
			signals.flush();
			await Promise.resolve();
		}
	};
	try {
		await settle();
		expect(viewer.activePath()).toBe("b");
		viewer.selectFile("a");
		await settle();
		expect(viewer.activePath()).toBe("a");
		viewer.closeFile("b");
		await settle();
		expect(viewer.openFiles().map((item) => item.path)).toEqual(["a"]);
		replaceSession();
		await settle();
		expect(reads).toEqual(["b"]);
		setRequest({ path: "c", token: 2 });
		await settle();
		expect(viewer.activePath()).toBe("c");
		viewer.closeFile("c");
		await settle();
		expect(viewer.activePath()).toBe("a");
		expect(reads).toEqual(["b", "c"]);
	} finally {
		dispose();
	}
});
