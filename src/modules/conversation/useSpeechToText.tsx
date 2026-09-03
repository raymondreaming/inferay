import { useCallback, useEffect, useRef, useState } from "octane";

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

function cleanupSpeechRecognition({
	shouldApplyResultsRef,
	ignoreAbortErrorRef,
	recognitionRef,
}: {
	shouldApplyResultsRef: { current: boolean };
	ignoreAbortErrorRef: { current: boolean };
	recognitionRef: { current: BrowserSpeechRecognition | null };
}) {
	shouldApplyResultsRef.current = false;
	ignoreAbortErrorRef.current = true;
	recognitionRef.current?.abort();
	recognitionRef.current = null;
}

function releaseSpeechRecognition({
	shouldApplyResultsRef,
	ignoreAbortErrorRef,
	recognitionRef,
	setIsListening,
}: {
	shouldApplyResultsRef: { current: boolean };
	ignoreAbortErrorRef: { current: boolean };
	recognitionRef: { current: BrowserSpeechRecognition | null };
	setIsListening: (value: boolean) => void;
}) {
	cleanupSpeechRecognition({
		shouldApplyResultsRef,
		ignoreAbortErrorRef,
		recognitionRef,
	});
	setIsListening(false);
}

export function useSpeechToText({
	enabled = true,
	value,
	onChange,
}: {
	enabled?: boolean;
	value: string;
	onChange: (value: string) => void;
}) {
	const [isListening, setIsListening] = useState(false);
	const [isSupported, setIsSupported] = useState(() =>
		Boolean(getSpeechRecognition()),
	);
	const [error, setError] = useState<string | null>(null);
	const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
	const baseTextRef = useRef(value);
	const valueRef = useRef(value);
	const shouldApplyResultsRef = useRef(false);
	const ignoreAbortErrorRef = useRef(false);

	useEffect(() => {
		if (!enabled) return;
		valueRef.current = value;
	}, [enabled, value]);

	useEffect(() => {
		if (!enabled) {
			releaseSpeechRecognition({
				shouldApplyResultsRef,
				ignoreAbortErrorRef,
				recognitionRef,
				setIsListening,
			});
			return;
		}
		return () => {
			releaseSpeechRecognition({
				shouldApplyResultsRef,
				ignoreAbortErrorRef,
				recognitionRef,
				setIsListening,
			});
		};
	}, [enabled]);

	useEffect(() => {
		if (!enabled || typeof window === "undefined") return;
		const releaseIfListening = () => {
			if (!recognitionRef.current) return;
			releaseSpeechRecognition({
				shouldApplyResultsRef,
				ignoreAbortErrorRef,
				recognitionRef,
				setIsListening,
			});
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
	}, [enabled]);

	const applyTranscript = useCallback(
		(event: BrowserSpeechRecognitionResultEvent) => {
			if (!shouldApplyResultsRef.current) return;
			let transcript = "";
			for (let index = 0; index < event.results.length; index += 1) {
				const result = event.results[index];
				const text = result?.[0]?.transcript;
				if (text) transcript += text;
			}
			onChange(appendTranscript(baseTextRef.current, transcript));
		},
		[onChange],
	);

	const startListening = useCallback(async () => {
		if (!enabled) return;
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
	}, [applyTranscript, enabled]);

	const stopListening = useCallback(() => {
		releaseSpeechRecognition({
			shouldApplyResultsRef,
			ignoreAbortErrorRef,
			recognitionRef,
			setIsListening,
		});
	}, []);

	const cancelListening = useCallback(() => {
		releaseSpeechRecognition({
			shouldApplyResultsRef,
			ignoreAbortErrorRef,
			recognitionRef,
			setIsListening,
		});
	}, []);

	const toggleListening = useCallback(() => {
		if (isListening) stopListening();
		else startListening();
	}, [isListening, startListening, stopListening]);
	const visibleIsListening = enabled && isListening;
	const visibleIsSupported = enabled && isSupported;

	return {
		cancelListening,
		error,
		isListening: visibleIsListening,
		isSupported: visibleIsSupported,
		stopListening,
		toggleListening,
	};
}
