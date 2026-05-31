export const FEATURE_FLAG_NAMES = [
	"terminal",
	"git",
	"prompts",
	"automations",
	"goals",
	"images",
	"simulators",
	"profile",
	"chat",
	"editor",
	"changes",
	"graph",
] as const;

export type FeatureFlagName = (typeof FEATURE_FLAG_NAMES)[number];
export type FeatureFlags = Record<FeatureFlagName, boolean>;

declare const __INFERAY_FEATURE_FLAGS__: FeatureFlags | undefined;

export const ENABLED_FEATURE_FLAGS = {
	terminal: true,
	git: true,
	prompts: true,
	automations: true,
	goals: true,
	images: true,
	simulators: true,
	profile: true,
	chat: true,
	editor: true,
	changes: true,
	graph: true,
} as const satisfies FeatureFlags;

export const DEV_FEATURE_FLAGS: FeatureFlags = {
	...ENABLED_FEATURE_FLAGS,
};

export const PUBLISHED_FEATURE_FLAGS: FeatureFlags = {
	terminal: true,
	git: false,
	prompts: true,
	automations: false,
	goals: false,
	images: true,
	simulators: false,
	profile: false,
	chat: true,
	editor: true,
	changes: false,
	graph: false,
};

const buildFeatureFlags =
	typeof __INFERAY_FEATURE_FLAGS__ === "object" &&
	__INFERAY_FEATURE_FLAGS__ !== null
		? __INFERAY_FEATURE_FLAGS__
		: null;

const isDevRuntime =
	typeof process !== "undefined" &&
	process.env?.TERMINAL_GUI_APP_ROOT !== undefined;

export const FEATURE_FLAGS: FeatureFlags =
	buildFeatureFlags ??
	(isDevRuntime ? DEV_FEATURE_FLAGS : PUBLISHED_FEATURE_FLAGS);
