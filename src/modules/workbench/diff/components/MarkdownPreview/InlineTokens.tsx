import * as stylex from "@octanejs/stylex";
import type { MdInlineToken } from "../../../../../shared/lib/data.ts";
import { MarkdownInline } from "../../../../../shared/ui/MarkdownInline/index.tsx";
import { styles } from "./styles.ts";

const appearance = {
	code: stylex.props(styles.inlineCode),
	bold: stylex.props(styles.strong),
	italic: stylex.props(styles.italic),
	"bold-italic": stylex.props(styles.strongBold),
	boldItalicEm: stylex.props(styles.italic),
	strikethrough: stylex.props(styles.deleted),
	image: { ...stylex.props(styles.image), alt: "" },
	link: stylex.props(styles.link),
};
export function InlineTokens({ tokens }: { tokens: MdInlineToken[] }) {
	return <MarkdownInline tokens={tokens} appearance={appearance} />;
}
