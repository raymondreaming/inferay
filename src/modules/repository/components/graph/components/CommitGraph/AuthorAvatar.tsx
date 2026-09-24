import { rememberLoadedAuthorAvatar } from "@repository/hooks/useGitAuthorAvatars.ts";
import { domStyle } from "@shared/lib/dom.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal } from "solid-js";
import * as inlineStyles from "./styles.ts";
import { GRAPH_DASH_PATTERN, GRAPH_DASH_WIDTH, styles } from "./styles.ts";
import { hexToRgba } from "./useCommitGraphState.tsx";

function authorInitials(name?: string | null) {
	const words = (typeof name === "string" ? name : "")
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	if (!words.length) return "?";
	if (words.length === 1) return words[0]!.slice(0, 2).toLocaleUpperCase();
	return `${words[0]![0] ?? ""}${words.at(-1)?.[0] ?? ""}`.toLocaleUpperCase();
}
export function AuthorAvatar(_props: {
	name?: string | null;
	email?: string | null;
	githubAvatar?: string | null;
	color: string;
	left: number;
	top: number;
	stash: boolean;
}) {
	const [failedUrl, setFailedUrl] = createSignal<string | null>(null);
	const [loadedUrl, setLoadedUrl] = createSignal<string | null>(null);
	return (
		<span
			aria-hidden="true"
			class={
				stylex.attrs(styles.graphAvatar, _props.stash && styles.stashNode).class
			}
			style={domStyle(
				inlineStyles.getAuthorAvatarGraphAvatarStyle(
					_props.left,
					_props.top,
					_props.stash ? "none" : `1px solid ${_props.color}`,
					`0 0 2px ${hexToRgba(_props.color, 0.18)}`,
				),
			)}
		>
			{_props.stash ? null : authorInitials(_props.name)}
			{!_props.stash &&
				_props.githubAvatar &&
				_props.githubAvatar !== failedUrl() && (
					<img
						src={_props.githubAvatar}
						alt=""
						loading="eager"
						referrerpolicy="no-referrer"
						onLoad={(event) => {
							const url = event.currentTarget.src;
							setLoadedUrl(url);
							rememberLoadedAuthorAvatar(_props.email, url);
						}}
						onError={() => setFailedUrl(_props.githubAvatar ?? null)}
						class={stylex.attrs(styles.avatarImage).class}
						style={{ opacity: loadedUrl() === _props.githubAvatar ? 1 : 0 }}
					/>
				)}
			{_props.stash && (
				<svg
					viewBox="0 0 18 18"
					width="18"
					height="18"
					class={stylex.attrs(styles.nodeOutline).class}
				>
					<rect
						x="0.5"
						y="0.5"
						width="17"
						height="17"
						rx="3"
						fill="var(--color-inferay-black)"
						stroke={_props.color}
						stroke-dasharray={GRAPH_DASH_PATTERN}
						stroke-width={GRAPH_DASH_WIDTH}
						stroke-linecap="round"
						pathLength={63}
						stroke-dashoffset={0.5}
					/>
					<path
						d="M4.5 5.5h9v2h-9z M5.5 7.5v5h7v-5 M7.5 9.5h3"
						fill="none"
						stroke={_props.color}
						stroke-width="1"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			)}
		</span>
	);
}
