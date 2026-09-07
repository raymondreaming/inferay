import * as stylex from "@stylexjs/stylex";
import type { MdInlineToken } from "../../../../../../build/presentation/contracts/MdInlineToken.ts";
import { MarkdownInline } from "../../../../../shared/ui/MarkdownInline/index.tsx";
import { styles } from "./styles.ts";

const appearance = {
	code: stylex.attrs(styles.inlineCode),
	bold: stylex.attrs(styles.strong),
	italic: stylex.attrs(styles.italic),
	"bold-italic": stylex.attrs(styles.strongBold),
	boldItalicEm: stylex.attrs(styles.italic),
	strikethrough: stylex.attrs(styles.deleted),
	image: {
		...stylex.attrs(styles.image),
		alt: "",
	},
	link: stylex.attrs(styles.link),
};
export function InlineTokens(_props: { tokens: MdInlineToken[] }) {
	return <MarkdownInline tokens={_props.tokens} appearance={appearance} />;
}
