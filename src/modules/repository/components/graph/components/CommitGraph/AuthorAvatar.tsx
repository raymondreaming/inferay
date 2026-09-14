import { domStyle } from "@shared/lib/dom.tsx";
import { IconGitCommit } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal } from "solid-js";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
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
	return (
		<span
			aria-hidden="true"
			{...stylex.attrs(styles.graphAvatar, _props.stash && styles.stashNode)}
			style={domStyle(
				inlineStyles.getAuthorAvatarGraphAvatarStyle(
					_props.left,
					_props.top,
					_props.stash ? "none" : `1px solid ${_props.color}`,
					`0 0 2px ${hexToRgba(_props.color, 0.18)}`,
				),
			)}
		>
			{_props.githubAvatar && _props.githubAvatar !== failedUrl() ? (
				<img
					src={_props.githubAvatar}
					alt=""
					loading="lazy"
					referrerpolicy="no-referrer"
					onError={() => setFailedUrl(_props.githubAvatar ?? null)}
					{...stylex.attrs(styles.avatarImage)}
				/>
			) : _props.stash ? (
				<IconGitCommit size={10} />
			) : (
				authorInitials(_props.name)
			)}
			{_props.stash && (
				<svg
					viewBox="0 0 18 18"
					width="18"
					height="18"
					{...stylex.attrs(styles.nodeOutline)}
				>
					<rect
						x="0.5"
						y="0.5"
						width="17"
						height="17"
						rx="3"
						fill="none"
						stroke={_props.color}
						stroke-dasharray="2 1"
					/>
				</svg>
			)}
		</span>
	);
}
