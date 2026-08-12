import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("chat message list is memoized at the component boundary", async () => {
	const source = readFileSync(
		"src/components/chat/ChatMessageList.tsx",
		"utf8",
	);

	expect(source).toContain("export const ChatMessageList = memo(");
	expect(source).toContain("getItemKey: getVirtualRowKey");
	expect(source).toContain("const CHAT_LIST_BOTTOM_PADDING_PX = 16;");
	expect(source).toContain(
		"element.scrollTo({ top: element.scrollHeight, behavior });",
	);
	expect(source).toContain("stickToBottom,\n\t\ttotalSize");
});
