import { expect, test } from "bun:test";
import { droppedPluginFiles } from "../../src/modules/workspace/components/ProjectsPanel/pluginImport.ts";

test("plugin folder drops preserve nested paths and read every directory batch", async () => {
	const binary = new File([new Uint8Array([0, 255, 128])], "scene.blend");
	const script = new File(["print('render')"], "render.py");
	const fileEntry = (file: File) => ({
		name: file.name,
		isFile: true,
		isDirectory: false,
		file: (resolve: (file: File) => void) => resolve(file),
	});
	const directory = (name: string, batches: object[][]) => ({
		name,
		isFile: false,
		isDirectory: true,
		createReader: () => {
			let index = 0;
			return {
				readEntries: (resolve: (entries: object[]) => void) =>
					resolve(batches[index++] ?? []),
			};
		},
	});
	const folder = directory("Blender kit", [
		[fileEntry(script)],
		[directory("models", [[fileEntry(binary)]])],
	]);
	const transfer = {
		items: [
			{ kind: "file", webkitGetAsEntry: () => folder, getAsFile: () => null },
		],
	} as unknown as DataTransfer;
	const result = await droppedPluginFiles(transfer);
	expect(result.name).toBe("Blender kit");
	expect(result.files.map((file) => file.path)).toEqual([
		"render.py",
		"models/scene.blend",
	]);
	expect(new Uint8Array(await result.files[1].file.arrayBuffer())).toEqual(
		new Uint8Array([0, 255, 128]),
	);
});

test("file drops work without directory entry support", async () => {
	const file = new File(["guide"], "README.md");
	const transfer = {
		items: [{ kind: "file", getAsFile: () => file }],
	} as unknown as DataTransfer;
	const result = await droppedPluginFiles(transfer);
	expect(result.files).toEqual([{ path: "README.md", file }]);
});
