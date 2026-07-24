declare const __INFERAY_FEATURE_FLAGS__: FeatureFlags | undefined;

export type FeatureFlagName =
	| "agent"
	| "git"
	| "prompts"
	| "automations"
	| "goals"
	| "sessions"
	| "images"
	| "simulators"
	| "profile"
	| "chat"
	| "editor"
	| "graph";

export type FeatureFlags = Record<FeatureFlagName, boolean>;

const ENABLED_FEATURE_FLAGS: FeatureFlags = {
	agent: true,
	git: true,
	prompts: true,
	automations: true,
	goals: true,
	sessions: true,
	images: true,
	simulators: true,
	profile: true,
	chat: true,
	editor: true,
	graph: true,
};

export const DEV_FEATURE_FLAGS: FeatureFlags = {
	...ENABLED_FEATURE_FLAGS,
};

export const PUBLISHED_FEATURE_FLAGS: FeatureFlags = {
	...ENABLED_FEATURE_FLAGS,
	automations: false,
	simulators: false,
};

const buildFeatureFlags =
	typeof __INFERAY_FEATURE_FLAGS__ === "object" &&
	__INFERAY_FEATURE_FLAGS__ !== null
		? __INFERAY_FEATURE_FLAGS__
		: null;

const isDevRuntime =
	typeof process !== "undefined" &&
	process.env?.AGENT_GUI_APP_ROOT !== undefined;

export const FEATURE_FLAGS: FeatureFlags =
	buildFeatureFlags ??
	(isDevRuntime ? DEV_FEATURE_FLAGS : PUBLISHED_FEATURE_FLAGS);
