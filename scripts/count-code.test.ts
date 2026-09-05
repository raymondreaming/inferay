import { expect, test } from "bun:test";
import { componentNames, rustProductionLines } from "./count-code";

test("counts wrapped and null-rendering components without hooks or route declarations", () => {
	expect(
		componentNames(`
		export const Button = memo(function Button() { return <button />; });
		function Redirect() { return null; }
		const Route = createFileRoute('/')({ component: Button });
		function useContent() { return <span />; }
		class Boundary extends Component { render() { return <div />; } }
	`),
	).toEqual(["Button", "Redirect", "Boundary"]);
});

test("Rust test removal ignores braces and fake attributes inside literals and nested comments", () => {
	const production = [
		'const TEXT: &str = r##"#[cfg(test)] { }"##;',
		"/* outer /* #[cfg(test)] { */ inner */",
		"fn live() { let c = '}'; }",
	];
	const source = [
		...production,
		"#[cfg(test)]",
		"mod tests {",
		"    #[test]",
		'    fn example() { let x = r#"}"#; }',
		"}",
	].join("\n");
	expect(rustProductionLines(source)).toBe(production.length);
	expect(rustProductionLines(`${source}\n`)).toBe(production.length);
});

test("standalone async tests and cfg(test) imports are excluded", () => {
	expect(
		rustProductionLines(
			[
				"#[cfg(test)]",
				"use test_support::Fixture;",
				'#[tokio::test(flavor = "multi_thread")]',
				"async fn exercise() { assert!(true); }",
				"pub fn application() {}",
			].join("\n"),
		),
	).toBe(1);
});
