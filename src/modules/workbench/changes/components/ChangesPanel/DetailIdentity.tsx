import * as stylex from "@octanejs/stylex";
import { useEffect, useState } from "octane";
import { resolveGitAuthorIdentity } from "../../../../repository/model/types.ts";
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
	const [identity, setIdentity] =
		useState<Awaited<ReturnType<typeof resolveGitAuthorIdentity>>>(null);
	const avatarUrl = identity?.avatarUrl;
	const displayName = identity?.login || name || "Unknown author";
	const [avatarFailed, setAvatarFailed] = useState(false);
	useEffect(() => {
		let current = true;
		setIdentity(null);
		setAvatarFailed(false);
		void resolveGitAuthorIdentity(email, name).then((url) => {
			if (current) setIdentity(url);
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
					detailInitials(displayName)
				)}
			</span>
			<span {...stylex.props(styles.detailIdentityCopy)}>
				{label ? (
					<span {...stylex.props(styles.detailIdentityLabel)}>{label}</span>
				) : null}
				<strong {...stylex.props(styles.authorText)}>{displayName}</strong>
				<span {...stylex.props(styles.mutedTextSmall)}>
					{formatDetailDate(date)}
				</span>
			</span>
		</div>
	);
}
