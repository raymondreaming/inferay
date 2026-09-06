import * as stylex from "@octanejs/stylex";
import { useState } from "octane";
import { IconGitCommit } from "../../../../../shared/ui/Icons/index.tsx";
import { hexToRgba } from "../../model/graph-model.ts";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

function authorInitials(name?: string | null) {
	const words = (typeof name === "string" ? name : "")
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	if (!words.length) return "?";
	if (words.length === 1) return words[0]!.slice(0, 2).toLocaleUpperCase();
	return `${words[0]![0] ?? ""}${words.at(-1)?.[0] ?? ""}`.toLocaleUpperCase();
}

export function AuthorAvatar({
	name,
	githubAvatar,
	color,
	left,
	top,
	stash,
}: {
	name?: string | null;
	email?: string | null;
	githubAvatar?: string | null;
	color: string;
	left: number;
	top: number;
	stash: boolean;
}) {
	const [failed, setFailed] = useState(false);
	return (
		<span
			aria-hidden="true"
			{...stylex.props(styles.graphAvatar, stash && styles.stashNode)}
			style={inlineStyles.getAuthorAvatarGraphAvatarStyle(
				left,
				top,
				`1px solid ${color}`,
				`0 0 2px ${hexToRgba(color, 0.18)}`,
			)}
		>
			{githubAvatar && !failed ? (
				<img
					src={githubAvatar}
					alt=""
					loading="lazy"
					referrerPolicy="no-referrer"
					onError={() => setFailed(true)}
					{...stylex.props(styles.avatarImage)}
				/>
			) : stash ? (
				<IconGitCommit size={10} />
			) : (
				authorInitials(name)
			)}
		</span>
	);
}
