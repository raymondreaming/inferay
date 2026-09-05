import * as stylex from "@octanejs/stylex";
import type { MdInlineToken } from "../../../../../shared/lib/data.ts";
import { styles } from "./styles.ts";
export function InlineTokens({ tokens }: { tokens: MdInlineToken[] }) {
	return (
		<>
			{tokens.map((tok, index) => (
				<InlineToken key={index} token={tok} />
			))}
		</>
	);
}

export function InlineToken({ token }: { token: MdInlineToken }) {
	switch (token.type) {
		case "linebreak":
			return <br />;

		case "image":
			return (
				<img
					src={token.href}
					alt={token.alt ?? ""}
					{...stylex.props(styles.image)}
				/>
			);

		case "link":
			return (
				<a
					href={token.href}
					{...stylex.props(styles.link)}
					target="_blank"
					rel="noopener noreferrer"
				>
					{token.children ? (
						<InlineTokens tokens={token.children} />
					) : (
						token.text
					)}
				</a>
			);

		case "code":
			return <code {...stylex.props(styles.inlineCode)}>{token.text}</code>;

		case "bold-italic":
			return (
				<strong {...stylex.props(styles.strongBold)}>
					<em {...stylex.props(styles.italic)}>
						{token.children ? (
							<InlineTokens tokens={token.children} />
						) : (
							token.text
						)}
					</em>
				</strong>
			);

		case "bold":
			return (
				<strong {...stylex.props(styles.strong)}>
					{token.children ? (
						<InlineTokens tokens={token.children} />
					) : (
						token.text
					)}
				</strong>
			);

		case "italic":
			return (
				<em {...stylex.props(styles.italic)}>
					{token.children ? (
						<InlineTokens tokens={token.children} />
					) : (
						token.text
					)}
				</em>
			);

		case "strikethrough":
			return (
				<del {...stylex.props(styles.deleted)}>
					{token.children ? (
						<InlineTokens tokens={token.children} />
					) : (
						token.text
					)}
				</del>
			);
		default:
			return <>{token.text}</>;
	}
}
