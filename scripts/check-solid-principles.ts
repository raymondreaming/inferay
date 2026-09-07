import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import * as t from "@babel/types";

const root = join(import.meta.dir, "..", "src");
const files = (directory: string): string[] =>
	readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? files(join(directory, entry.name))
			: /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")
				? [join(directory, entry.name)]
				: [],
	);
const errors: string[] = [];
let count = 0;
// These arrays are fixed visual definitions, constructed once, not reactive collections.
const staticLists = new Map([
	[
		"modules/settings/components/Settings/SettingsContent.tsx",
		new Set(["APP_THEMES"]),
	],
	[
		"modules/settings/components/SettingsModal/index.tsx",
		new Set(["SETTINGS_SECTIONS"]),
	],
	[
		"modules/workspace/components/WorkspaceSidebar/SidebarWorkspacesSection.tsx",
		new Set(["GRID_DIMENSIONS"]),
	],
	["shared/ui/DotMatrixLoader/DotMatrixRipple.tsx", new Set(["RIPPLE_DOTS"])],
	["shared/ui/DotMatrixLoader/DotMatrixWeave.tsx", new Set(["WEAVE_DOTS"])],
	["shared/ui/DotMatrixLoader/index.tsx", new Set(["SPIRAL_DOTS"])],
	["shared/ui/Icons/shared.tsx", new Set(["pathList"])],
]);
// These custom primitives bind external subscriptions during construction.
// Their disposal must not wait for a subtree's async content to settle.
const cleanupBridges = new Set([
	"shared/hooks/useQueryResource.tsx",
	"shared/lib/dom.tsx",
]);
function containsJSX(node: t.Node): boolean {
	let found = false;
	t.traverseFast(node, (child) => {
		if (t.isJSXElement(child) || t.isJSXFragment(child)) found = true;
	});
	return found;
}
function staticArray(node: t.Node): boolean {
	if (t.isTSAsExpression(node)) return staticArray(node.expression);
	return (
		t.isArrayExpression(node) &&
		node.elements.every(
			(element) =>
				element !== null &&
				(t.isStringLiteral(element) || t.isNumericLiteral(element)),
		)
	);
}
for (const file of files(root)) {
	const name = relative(root, file);
	if (name.endsWith("styles.ts")) continue;
	count++;
	const ast = parse(readFileSync(file, "utf8"), {
		sourceType: "module",
		plugins: ["typescript", "jsx"],
	});
	const fail = (node: t.Node, message: string) =>
		errors.push(`${name}:${node.loc?.start.line ?? 1}: ${message}`);
	traverse(ast, {
		ImportDeclaration(path) {
			if (
				/^(react(?:-dom)?(?:\/|$)|octane|@octanejs\/|solid-js\/web|@tanstack\/(?:react-|solid-router|router-))/.test(
					path.node.source.value,
				)
			)
				fail(path.node, "Use the Solid 2 renderer and router entrypoints.");
			if (path.node.source.value === "solid-js")
				for (const specifier of path.node.specifiers) {
					if (
						t.isImportSpecifier(specifier) &&
						t.isIdentifier(specifier.imported) &&
						[
							"onMount",
							"createResource",
							"createComputed",
							"createDeferred",
							"useTransition",
						].includes(specifier.imported.name)
					)
						fail(
							specifier,
							"Use Solid 2 derivation, lifecycle, or action APIs.",
						);
				}
		},
		CallExpression(path) {
			const { node } = path;
			if (t.isIdentifier(node.callee, { name: "createEffect" })) {
				if (node.arguments.length < 2)
					fail(
						node,
						"Effects need separate tracked compute and imperative apply phases.",
					);
				const compute = node.arguments[0];
				if (
					t.isArrowFunctionExpression(compute) &&
					t.isArrayExpression(compute.body) &&
					compute.body.elements.length === 0
				)
					fail(node, "Use onSettled for mount-only setup and teardown.");
			}
			if (
				t.isIdentifier(node.callee, { name: "createMemo" }) &&
				node.arguments[0] &&
				containsJSX(node.arguments[0])
			)
				fail(
					node,
					"Memoize data; keep component structure in JSX and flow components.",
				);
			if (
				t.isIdentifier(node.callee, { name: "onCleanup" }) &&
				!cleanupBridges.has(name)
			)
				fail(
					node,
					"Use owned onSettled setup with returned teardown; custom bridges need an explicit audit.",
				);
			checkList(path);
		},
		OptionalCallExpression: checkList,
		JSXAttribute(path) {
			if (
				!t.isJSXIdentifier(path.node.name, { name: "ref" }) ||
				!t.isJSXExpressionContainer(path.node.value)
			)
				return;
			const value = path.node.value.expression;
			if (!t.isArrowFunctionExpression(value) && !t.isFunctionExpression(value))
				return;
			t.traverseFast(value.body, (node) => {
				if (
					t.isCallExpression(node) &&
					t.isIdentifier(node.callee) &&
					["createEffect", "onCleanup", "onSettled"].includes(node.callee.name)
				)
					fail(
						node,
						"Ref callbacks have no owner; register lifecycle work in a directive factory or component setup.",
					);
			});
		},
		VariableDeclarator(path) {
			const { node } = path;
			if (
				t.isCallExpression(node.init) &&
				t.isIdentifier(node.init.callee, { name: "createMemo" })
			) {
				const compute = node.init.arguments[0];
				if (
					t.isArrowFunctionExpression(compute) &&
					t.isIdentifier(compute.body) &&
					path.scope.getBinding(compute.body.name)?.kind === "param"
				)
					fail(
						node,
						"Read the props object directly instead of memoizing its fixed identity.",
					);
			}
			if (
				t.isIdentifier(node.id) &&
				/^_.*Value\d*$/.test(node.id.name) &&
				path.findParent(
					(parent) => parent.isObjectMethod() && parent.node.kind === "get",
				) &&
				path.scope.getBinding(node.id.name)?.referencePaths.length === 0
			)
				fail(
					node,
					"Remove unused generated getter reads that subscribe to unrelated state.",
				);
		},
	});
	function checkList(path: any) {
		const { node } = path;
		if (
			(!t.isMemberExpression(node.callee) &&
				!t.isOptionalMemberExpression(node.callee)) ||
			!t.isIdentifier(node.callee.property, { name: "map" })
		)
			return;
		const callback = node.arguments[0];
		if (!callback || !containsJSX(callback)) return;
		const source = node.callee.object;
		if (
			staticArray(source) ||
			(t.isIdentifier(source) && staticLists.get(name)?.has(source.name))
		)
			return;
		fail(
			node,
			"Render reactive collections with For/Repeat and an explicit identity policy.",
		);
	}
}
if (errors.length) {
	console.error(errors.join("\n"));
	process.exitCode = 1;
} else
	console.log(
		`Solid 2 structural checks passed across ${count} source files. Behavioral verification is separate.`,
	);
