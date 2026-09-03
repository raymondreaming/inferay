import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("chat message list is memoized at the component boundary", async () => {
	const source = readFileSync(
		"src/modules/conversation/ChatMessageList.tsx",
		"utf8",
	);

	expect(source).toContain("export const ChatMessageList = memo(");
	expect(source).toContain("const CHAT_LIST_BOTTOM_PADDING_PX = 16;");
	expect(source).toContain(
		"element.scrollTo({ top: element.scrollHeight, behavior });",
	);
	expect(source).not.toContain("useVirtualizer");
	expect(source).toContain('messageRow: {\n\t\tboxSizing: "border-box",');
	expect(source).toContain('position: "relative",\n\t\twidth: "100%"');
});
