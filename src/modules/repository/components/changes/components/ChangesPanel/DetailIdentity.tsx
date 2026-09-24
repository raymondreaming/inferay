import {
	knownAuthorAvatar,
	rememberLoadedAuthorAvatar,
} from "@repository/hooks/useGitAuthorAvatars.ts";
import { resolveGitAuthorIdentity } from "@repository/services/gitApi.ts";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, Loading } from "solid-js";
import { styles } from "./styles.ts";

function detailInitials(name?: string | null) {
	const words = (typeof name === "string" ? name : "")
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	return `${words[0]?.[0] ?? "?"}${words.length > 1 ? (words.at(-1)?.[0] ?? "") : ""}`.toLocaleUpperCase();
}
function formatDetailDate(value?: string | null) {
	const parsed = new Date(value ?? "");
	return Number.isNaN(parsed.getTime())
		? value || "Unknown date"
		: parsed.toLocaleString();
}
export function DetailIdentity(_props: {
	cwd?: string;
	hash?: string;
	label?: string;
	name?: string | null;
	email?: string | null;
	date?: string | null;
}) {
	const identity = createMemo(() =>
		resolveGitAuthorIdentity(
			_props.cwd,
			_props.hash,
			_props.email,
			_props.name,
		),
	);
	const avatarUrl = createMemo(
		() => knownAuthorAvatar(_props.email) ?? identity()?.avatarUrl,
	);
	const displayName = createMemo(
		() => identity()?.login || _props.name || "Unknown author",
	);
	const [failedUrl, setFailedUrl] = createSignal<string | null>(null);
	return (
		<div
			title={_props.email ?? undefined}
			{...stylex.attrs(styles.detailIdentity)}
		>
			<span {...stylex.attrs(styles.detailAvatar)} aria-hidden="true">
				<Loading fallback={detailInitials(_props.name)}>
					{avatarUrl() && avatarUrl() !== failedUrl() ? (
						<img
							src={avatarUrl() ?? undefined}
							alt=""
							loading="lazy"
							referrerpolicy="no-referrer"
							onLoad={(event) =>
								rememberLoadedAuthorAvatar(
									_props.email,
									event.currentTarget.src,
								)
							}
							onError={() => setFailedUrl(avatarUrl() ?? null)}
							{...stylex.attrs(styles.detailAvatarImage)}
						/>
					) : (
						detailInitials(displayName())
					)}
				</Loading>
			</span>
			<span {...stylex.attrs(styles.detailIdentityCopy)}>
				{_props.label ? (
					<span {...stylex.attrs(styles.detailIdentityLabel)}>
						{_props.label}
					</span>
				) : null}
				<strong {...stylex.attrs(styles.authorText)}>
					<Loading fallback={_props.name || "Unknown author"}>
						{displayName()}
					</Loading>
				</strong>
				<span {...stylex.attrs(styles.mutedTextSmall)}>
					{formatDetailDate(_props.date)}
				</span>
			</span>
		</div>
	);
}
