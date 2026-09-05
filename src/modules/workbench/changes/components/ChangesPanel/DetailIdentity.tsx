import * as stylex from "@octanejs/stylex";
import { useEffect, useState } from "octane";
import { resolveGitAuthorAvatar } from "../../../../repository/model/git-avatar.ts";
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

export function DetailIdentity({
	label,
	name,
	email,
	date,
}: {
	label?: string;
	name?: string | null;
	email?: string | null;
	date?: string | null;
}) {
	const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
	const [avatarFailed, setAvatarFailed] = useState(false);
	useEffect(() => {
		let current = true;
		setAvatarUrl(null);
		setAvatarFailed(false);
		void resolveGitAuthorAvatar(email, name).then((url) => {
			if (current) setAvatarUrl(url);
		});
		return () => {
			current = false;
		};
	}, [email, name]);
	return (
		<div title={email ?? undefined} {...stylex.props(styles.detailIdentity)}>
			<span {...stylex.props(styles.detailAvatar)} aria-hidden="true">
				{avatarUrl && !avatarFailed ? (
					<img
						src={avatarUrl}
						alt=""
						loading="lazy"
						referrerPolicy="no-referrer"
						onError={() => setAvatarFailed(true)}
						{...stylex.props(styles.detailAvatarImage)}
					/>
				) : (
					detailInitials(name)
				)}
			</span>
			<span {...stylex.props(styles.detailIdentityCopy)}>
				{label ? (
					<span {...stylex.props(styles.detailIdentityLabel)}>{label}</span>
				) : null}
				<strong {...stylex.props(styles.authorText)}>
					{name || "Unknown author"}
				</strong>
				<span {...stylex.props(styles.mutedTextSmall)}>
					{formatDetailDate(date)}
				</span>
			</span>
		</div>
	);
}
