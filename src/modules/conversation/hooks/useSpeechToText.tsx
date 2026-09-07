import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	untrack,
} from "solid-js";

const SPEECH_RECOGNITION_LANGUAGE = "en-US";
type BrowserSpeechRecognitionAlternative = {
	transcript: string;
};
type BrowserSpeechRecognitionResult = {
	[index: number]: BrowserSpeechRecognitionAlternative | undefined;
	isFinal: boolean;
};
type BrowserSpeechRecognitionResultList = {
	[index: number]: BrowserSpeechRecognitionResult | undefined;
	length: number;
};
type BrowserSpeechRecognitionResultEvent = Event & {
	results: BrowserSpeechRecognitionResultList;
};
type BrowserSpeechRecognitionErrorEvent = Event & {
	error?: string;
	message?: string;
};
type BrowserSpeechRecognition = {
	continuous: boolean;
	interimResults: boolean;
	lang: string;
	onend: (() => void) | null;
	onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
	onresult: ((event: BrowserSpeechRecognitionResultEvent) => void) | null;
	abort: () => void;
	start: () => void;
	stop: () => void;
};
type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;
type SpeechRecognitionWindow = Window & {
	SpeechRecognition?: BrowserSpeechRecognitionConstructor;
	webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
};
function getSpeechRecognition() {
	if (typeof window === "undefined") return null;
	const speechWindow = window as SpeechRecognitionWindow;
	return (
		speechWindow.SpeechRecognition ??
		speechWindow.webkitSpeechRecognition ??
		null
	);
}
function appendTranscript(baseText: string, transcript: string) {
	const spokenText = transcript.trim();
	if (!spokenText) return baseText;
	if (!baseText) return spokenText;
	return `${baseText}${/\s$/.test(baseText) ? "" : " "}${spokenText}`;
}
function formatSpeechError(event: BrowserSpeechRecognitionErrorEvent) {
	switch (event.error) {
		case "not-allowed":
		case "service-not-allowed":
			return "Microphone access was blocked. Allow microphone access for inferay in System Settings.";
		case "no-speech":
			return "No speech was detected.";
		case "audio-capture":
			return "No microphone was found.";
		case "network":
			return "Speech recognition lost network access.";
		default:
			return event.message || "Speech recognition stopped.";
	}
}
export function useSpeechToText(
	_options: Accessor<{
		enabled?: boolean;
		value: string;
		onChange: (value: string) => void;
	}>,
) {
	const [isListening, setIsListening] = createSignal(false);
	const [isSupported, setIsSupported] = createSignal(
		(() => Boolean(getSpeechRecognition()))(),
	);
	const [error, setError] = createSignal<string | null>(null);
	const recognitionRef = {
		current: null,
	} as {
		current: BrowserSpeechRecognition | null;
	};
	const baseTextRef = {
		current: untrack(() => _options().value),
	};
	const valueRef = {
		current: untrack(() => _options().value),
	};
	const shouldApplyResultsRef = {
		current: false,
	};
	const ignoreAbortErrorRef = {
		current: false,
	};
	const release = () => {
		shouldApplyResultsRef.current = false;
		ignoreAbortErrorRef.current = true;
		recognitionRef.current?.abort();
		recognitionRef.current = null;
		setIsListening(false);
	};
	createEffect(
		() => {
			const _optionsValue = _options();
			return [_optionsValue.enabled ?? true, _optionsValue.value] as const;
		},
		([enabled, value]) => {
			if (!enabled) return;
			valueRef.current = value;
		},
	);
	createEffect(
		() => _options().enabled ?? true,
		(enabled) => {
			if (!enabled) {
				release();
				return;
			}
			return () => {
				release();
			};
		},
	);
	createEffect(
		() => _options().enabled ?? true,
		(enabled) => {
			if (!enabled || typeof window === "undefined") return;
			const releaseIfListening = () => {
				if (!recognitionRef.current) return;
				release();
			};
			const releaseWhenHidden = () => {
				if (document.visibilityState === "hidden") releaseIfListening();
			};
			window.addEventListener("blur", releaseIfListening);
			window.addEventListener("pagehide", releaseIfListening);
			document.addEventListener("visibilitychange", releaseWhenHidden);
			return () => {
				window.removeEventListener("blur", releaseIfListening);
				window.removeEventListener("pagehide", releaseIfListening);
				document.removeEventListener("visibilitychange", releaseWhenHidden);
			};
		},
	);
	const applyTranscript = (event: BrowserSpeechRecognitionResultEvent) => {
		if (!shouldApplyResultsRef.current) return;
		let transcript = "";
		for (let index = 0; index < event.results.length; index += 1) {
			const result = event.results[index];
			const text = result?.[0]?.transcript;
			if (text) transcript += text;
		}
		_options().onChange(appendTranscript(baseTextRef.current, transcript));
	};
	const startListening = async () => {
		if (!(_options().enabled ?? true)) return;
		const Recognition = getSpeechRecognition();
		if (!Recognition) {
			setIsSupported(false);
			setError("Speech recognition is not supported in this browser.");
			return;
		}
		shouldApplyResultsRef.current = false;
		ignoreAbortErrorRef.current = true;
		recognitionRef.current?.abort();
		const recognition = new Recognition();
		recognition.continuous = true;
		recognition.interimResults = true;
		recognition.lang = SPEECH_RECOGNITION_LANGUAGE;
		baseTextRef.current = valueRef.current;
		shouldApplyResultsRef.current = true;
		ignoreAbortErrorRef.current = false;
		recognition.onresult = applyTranscript;
		recognition.onerror = (event) => {
			if (ignoreAbortErrorRef.current && event.error === "aborted") return;
			if (recognitionRef.current === recognition) {
				setError(formatSpeechError(event));
				setIsListening(false);
			}
		};
		recognition.onend = () => {
			if (recognitionRef.current === recognition) {
				recognitionRef.current = null;
				shouldApplyResultsRef.current = false;
				setIsListening(false);
			}
		};
		recognitionRef.current = recognition;
		setError(null);
		setIsListening(true);
		try {
			recognition.start();
		} catch {
			recognitionRef.current = null;
			shouldApplyResultsRef.current = false;
			setIsListening(false);
			setError("Speech recognition could not start.");
		}
	};
	const toggleListening = () => {
		if (isListening()) release();
		else startListening();
	};
	const visibleIsListening = createMemo(
		() => (_options().enabled ?? true) && isListening(),
	);
	const visibleIsSupported = createMemo(
		() => (_options().enabled ?? true) && isSupported(),
	);
	return {
		get cancelListening() {
			return release;
		},
		get error() {
			return error();
		},
		get isListening() {
			return visibleIsListening();
		},
		get isSupported() {
			return visibleIsSupported();
		},
		get stopListening() {
			return release;
		},
		get toggleListening() {
			return toggleListening;
		},
	};
}
