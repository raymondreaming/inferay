import type { MdInlineToken } from "@contracts";
import { MarkdownInline } from "@shared/ui/MarkdownInline/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { styles } from "./styles.ts";

const appearance = {
	code: stylex.attrs(styles.inlineCode),
	bold: stylex.attrs(styles.strong),
	italic: stylex.attrs(styles.em),
	"bold-italic": stylex.attrs(styles.strong),
	image: {
		style: {
			"max-width": "100%",
		},
	},
	markdown_path: stylex.attrs(styles.inlinePathButton),
	link: stylex.attrs(styles.link),
	url: stylex.attrs(styles.linkUnderlined),
};
export function Inline(props: {
	tokens: MdInlineToken[];
	onMdFileClick?: (path: string) => void;
}) {
	return <MarkdownInline {...props} appearance={appearance} />;
}
