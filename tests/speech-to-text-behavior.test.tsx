import { expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { createRoot } from "react-dom/client";

function setupDom() {
	const dom = new JSDOM('<div id="root"></div>', {
		pretendToBeVisual: true,
		url: "http://localhost/#/agent",
	});
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: dom.window,
	});
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: dom.window.document,
	});
	const rootElement = dom.window.document.getElementById("root");
	if (!rootElement) throw new Error("Missing root element");
	return { dom, root: createRoot(rootElement), rootElement };
}

function tick(ms = 0) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

test("speech recognition starts without a separate getUserMedia probe", async () => {
	const { dom, root } = setupDom();
	const getUserMedia = mock(() => {
		throw new Error("getUserMedia should not be called");
	});
	const start = mock(() => {});
	const abort = mock(() => {});
	const stop = mock(() => {});
	class FakeSpeechRecognition {
		continuous = false;
		interimResults = false;
		lang = "";
		onend = null;
		onerror = null;
		onresult = null;
		abort = abort;
		start = start;
		stop = stop;
	}
	Object.defineProperty(dom.window.navigator, "mediaDevices", {
		configurable: true,
		value: { getUserMedia },
	});
	Object.defineProperty(dom.window, "webkitSpeechRecognition", {
		configurable: true,
		value: FakeSpeechRecognition,
	});
	const { useSpeechToText } =
		await import("../src/components/chat/useSpeechToText.ts");

	try {
		function Harness() {
			const { toggleListening } = useSpeechToText({
				value: "",
				onChange: () => {},
			});
			return (
				<button type="button" onClick={toggleListening}>
					Start
				</button>
			);
		}

		root.render(<Harness />);
		await tick(20);
		const button = dom.window.document.querySelector("button");
		if (!button) throw new Error("Missing start button");
		button.click();
		await tick(20);

		expect(start).toHaveBeenCalledTimes(1);
		expect(getUserMedia).toHaveBeenCalledTimes(0);
	} finally {
		root.unmount();
	}
});

test("speech recognition stop aborts the recognizer immediately", async () => {
	const { dom, root } = setupDom();
	const start = mock(() => {});
	const abort = mock(() => {});
	const stop = mock(() => {});
	class FakeSpeechRecognition {
		continuous = false;
		interimResults = false;
		lang = "";
		onend = null;
		onerror = null;
		onresult = null;
		abort = abort;
		start = start;
		stop = stop;
	}
	Object.defineProperty(dom.window, "webkitSpeechRecognition", {
		configurable: true,
		value: FakeSpeechRecognition,
	});
	const { useSpeechToText } =
		await import("../src/components/chat/useSpeechToText.ts");

	try {
		function Harness() {
			const { toggleListening } = useSpeechToText({
				value: "",
				onChange: () => {},
			});
			return (
				<button type="button" onClick={toggleListening}>
					Toggle
				</button>
			);
		}

		root.render(<Harness />);
		await tick(20);
		const button = dom.window.document.querySelector("button");
		if (!button) throw new Error("Missing toggle button");
		button.click();
		await tick(20);
		button.click();
		await tick(20);

		expect(start).toHaveBeenCalledTimes(1);
		expect(abort).toHaveBeenCalledTimes(1);
		expect(stop).toHaveBeenCalledTimes(0);
	} finally {
		root.unmount();
	}
});

test("speech recognition aborts when the app window loses focus", async () => {
	const { dom, root } = setupDom();
	const start = mock(() => {});
	const abort = mock(() => {});
	class FakeSpeechRecognition {
		continuous = false;
		interimResults = false;
		lang = "";
		onend = null;
		onerror = null;
		onresult = null;
		abort = abort;
		start = start;
		stop = mock(() => {});
	}
	Object.defineProperty(dom.window, "webkitSpeechRecognition", {
		configurable: true,
		value: FakeSpeechRecognition,
	});
	const { useSpeechToText } =
		await import("../src/components/chat/useSpeechToText.ts");

	try {
		function Harness() {
			const { toggleListening } = useSpeechToText({
				value: "",
				onChange: () => {},
			});
			return (
				<button type="button" onClick={toggleListening}>
					Start
				</button>
			);
		}

		root.render(<Harness />);
		await tick(20);
		const button = dom.window.document.querySelector("button");
		if (!button) throw new Error("Missing start button");
		button.click();
		await tick(20);
		dom.window.dispatchEvent(new dom.window.Event("blur"));
		await tick(20);

		expect(start).toHaveBeenCalledTimes(1);
		expect(abort).toHaveBeenCalledTimes(1);
	} finally {
		root.unmount();
	}
});
