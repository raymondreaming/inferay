import * as stylex from "@stylexjs/stylex";
import type { MdInlineToken } from "../../../../../build/presentation/contracts/MdInlineToken.ts";
import { domStyle } from "../../../../shared/lib/dom.tsx";
import { MarkdownInline } from "../../../../shared/ui/MarkdownInline/index.tsx";
import { getInlineImgStyle, styles } from "./styles.ts";

const appearance = {
	code: stylex.attrs(styles.inlineCode),
	bold: stylex.attrs(styles.strong),
	italic: stylex.attrs(styles.em),
	"bold-italic": stylex.attrs(styles.strong),
	image: {
		style: domStyle(getInlineImgStyle()),
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
