import * as stylex from "@octanejs/stylex";
import { Fragment, memo } from "octane";
import type { MdInlineToken } from "../../../../shared/lib/markdown.ts";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

export const Inline = memo(function Inline({
	tokens,
	onMdFileClick,
}: {
	tokens: MdInlineToken[];
	onMdFileClick?: (path: string) => void;
}) {
	return (
		<>
			{tokens.map((token, index) => {
				const children = token.children ? (
					<Inline
						key={index}
						tokens={token.children}
						onMdFileClick={onMdFileClick}
					/>
				) : (
					token.text
				);
				switch (token.type) {
					case "code":
						return (
							<code key={index} {...stylex.props(styles.inlineCode)}>
								{token.text}
							</code>
						);
					case "bold":
						return (
							<strong key={index} {...stylex.props(styles.strong)}>
								{children}
							</strong>
						);
					case "italic":
						return (
							<em key={index} {...stylex.props(styles.em)}>
								{children}
							</em>
						);
					case "bold-italic":
						return (
							<strong key={index} {...stylex.props(styles.strong)}>
								<em>{children}</em>
							</strong>
						);
					case "strikethrough":
						return <del key={index}>{children}</del>;
					case "linebreak":
						return <br key={index} />;
					case "image":
						return (
							<img
								key={index}
								src={token.href}
								alt={token.alt ?? token.text}
								style={inlineStyles.getInlineImgStyle()}
							/>
						);
					case "markdown_path":
						if (onMdFileClick)
							return (
								<button
									key={index}
									type="button"
									onClick={() => onMdFileClick(token.text)}
									{...stylex.props(styles.inlinePathButton)}
								>
									{token.text}
								</button>
							);
						return <Fragment key={index}>{token.text}</Fragment>;
					case "link":
					case "url":
						return (
							<a
								key={index}
								href={token.href}
								target="_blank"
								rel="noopener noreferrer"
								{...stylex.props(
									token.type === "url" ? styles.linkUnderlined : styles.link,
								)}
							>
								{children}
							</a>
						);
					default:
						return <Fragment key={index}>{token.text}</Fragment>;
				}
			})}
		</>
	);
});
