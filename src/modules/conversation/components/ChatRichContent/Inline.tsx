import * as stylex from "@octanejs/stylex";
import type { MdInlineToken } from "../../../../shared/lib/data.ts";
import { MarkdownInline } from "../../../../shared/ui/MarkdownInline/index.tsx";
import { getInlineImgStyle, styles } from "./styles.ts";

const appearance = {
	code: stylex.props(styles.inlineCode),
	bold: stylex.props(styles.strong),
	italic: stylex.props(styles.em),
	"bold-italic": stylex.props(styles.strong),
	image: { style: getInlineImgStyle() },
	markdown_path: stylex.props(styles.inlinePathButton),
	link: stylex.props(styles.link),
	url: stylex.props(styles.linkUnderlined),
};
export function Inline(props: {
	tokens: MdInlineToken[];
	onMdFileClick?: (path: string) => void;
}) {
	return <MarkdownInline {...props} appearance={appearance} />;
}
