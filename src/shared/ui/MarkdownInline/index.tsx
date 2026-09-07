import type { JSX } from "@solidjs/web";
import { createMemo, For, Match, Show, Switch } from "solid-js";
import type { MdInlineToken } from "../../../../build/presentation/contracts/MdInlineToken.ts";
export type InlineAppearance = Partial<
	Record<
		MdInlineToken["type"] | "boldItalicEm",
		{
			class?: string;
			style?: JSX.CSSProperties | string;
			alt?: string;
		}
	>
>;
type InlineProps = {
	appearance: InlineAppearance;
	onMdFileClick?: (path: string) => void;
};
export function MarkdownInline(
	props: InlineProps & { tokens: MdInlineToken[] },
) {
	return (
		<For each={props.tokens} keyed={false}>
			{(token) => (
				<InlineToken
					token={token()}
					appearance={props.appearance}
					onMdFileClick={props.onMdFileClick}
				/>
			)}
		</For>
	);
}
function InlineToken(props: InlineProps & { token: MdInlineToken }) {
	const kind = createMemo(() => props.token.type);
	const appearance = createMemo(() => props.appearance[kind()]);
	const Children = () => (
		<Show when={props.token.children} fallback={props.token.text}>
			{(tokens) => (
				<MarkdownInline
					tokens={tokens()}
					appearance={props.appearance}
					onMdFileClick={props.onMdFileClick}
				/>
			)}
		</Show>
	);
	return (
		<Switch fallback={<>{props.token.text}</>}>
			<Match when={kind() === "code"}>
				<code {...appearance()}>{props.token.text}</code>
			</Match>
			<Match when={kind() === "bold"}>
				<strong {...appearance()}>
					<Children />
				</strong>
			</Match>
			<Match when={kind() === "italic"}>
				<em {...appearance()}>
					<Children />
				</em>
			</Match>
			<Match when={kind() === "strikethrough"}>
				<del {...appearance()}>
					<Children />
				</del>
			</Match>
			<Match when={kind() === "bold-italic"}>
				<strong {...appearance()}>
					<em {...props.appearance.boldItalicEm}>
						<Children />
					</em>
				</strong>
			</Match>
			<Match when={kind() === "linebreak"}>
				<br />
			</Match>
			<Match when={kind() === "image"}>
				<img
					{...appearance()}
					src={props.token.href}
					alt={props.token.alt ?? appearance()?.alt ?? props.token.text}
				/>
			</Match>
			<Match when={kind() === "markdown_path" && !!props.onMdFileClick}>
				<button
					type="button"
					{...appearance()}
					onClick={() => props.onMdFileClick?.(props.token.text)}
				>
					{props.token.text}
				</button>
			</Match>
			<Match when={kind() === "link" || (kind() === "url" && !!appearance())}>
				<a
					{...appearance()}
					href={props.token.href}
					target="_blank"
					rel="noopener noreferrer"
				>
					<Children />
				</a>
			</Match>
		</Switch>
	);
}
