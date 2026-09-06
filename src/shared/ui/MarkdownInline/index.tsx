import { Fragment, memo } from "octane";
import type { CSSProperties } from "react";
import type { MdInlineToken } from "../../lib/data.ts";

export type InlineAppearance = Partial<
	Record<
		MdInlineToken["type"] | "boldItalicEm",
		{ className?: string; style?: CSSProperties; alt?: string }
	>
>;
const tags = {
	code: "code",
	bold: "strong",
	italic: "em",
	strikethrough: "del",
} as const;

export const MarkdownInline = memo(function MarkdownInline({
	tokens,
	appearance,
	onMdFileClick,
}: {
	tokens: MdInlineToken[];
	appearance: InlineAppearance;
	onMdFileClick?: (path: string) => void;
}) {
	return (
		<>
			{tokens.map((token, index) => {
				const children = token.children ? (
					<MarkdownInline
						tokens={token.children}
						appearance={appearance}
						onMdFileClick={onMdFileClick}
					/>
				) : (
					token.text
				);
				const props = appearance[token.type];
				switch (token.type) {
					case "code":
					case "bold":
					case "italic":
					case "strikethrough": {
						const Tag = tags[token.type];
						return (
							<Tag key={index} {...props}>
								{token.type === "code" ? token.text : children}
							</Tag>
						);
					}
					case "bold-italic":
						return (
							<strong key={index} {...props}>
								<em {...appearance.boldItalicEm}>{children}</em>
							</strong>
						);
					case "linebreak":
						return <br key={index} />;
					case "image":
						return (
							<img
								key={index}
								{...props}
								src={token.href}
								alt={token.alt ?? props?.alt ?? token.text}
							/>
						);
					case "markdown_path":
						if (onMdFileClick)
							return (
								<button
									key={index}
									type="button"
									{...props}
									onClick={() => onMdFileClick(token.text)}
								>
									{token.text}
								</button>
							);
						break;
					case "url":
					case "link":
						if (token.type === "url" && !props) break;
						return (
							<a
								key={index}
								{...props}
								href={token.href}
								target="_blank"
								rel="noopener noreferrer"
							>
								{children}
							</a>
						);
				}
				return <Fragment key={index}>{token.text}</Fragment>;
			})}
		</>
	);
});
