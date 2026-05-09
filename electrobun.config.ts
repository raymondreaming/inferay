import type { ElectrobunConfig } from "electrobun";

const config: ElectrobunConfig = {
	app: {
		name: "inferay",
		identifier: "com.inferay.app",
		version: "0.1.10",
		description: "Run Claude and Codex side by side in a multi-pane terminal",
	},
	build: {
		bun: {
			entrypoint: "src/index.ts",
			format: "esm",
			sourcemap: "external",
		},
		copy: {
			dist: "views",
			data: "data",
			native: "native",
			public: "public",
		},
		mac: {
			icons: "public/icon.iconset",
			codesign: false,
			notarize: false,
			createDmg: true,
			entitlements: {
				"com.apple.security.device.microphone":
					"inferay uses the microphone to transcribe voice input into chat drafts.",
				"com.apple.security.personal-information.speech-recognition":
					"inferay uses speech recognition to convert spoken words into chat text.",
			},
		},
	},
	scripts: {
		postBuild: "scripts/ensure-electrobun-views.ts",
	},
	runtime: {
		exitOnLastWindowClosed: true,
	},
};

export default config;
