import * as stylex from "@stylexjs/stylex";
import {
	IconAlertTriangle,
	IconCheck,
	IconUser,
} from "../../components/ui/Icons.tsx";
import { Notice } from "../../components/ui/Surface.tsx";
import type { ForgeAccount } from "../../features/forge/types.ts";
import { color, font } from "../../tokens.stylex.ts";

export function ProfileAccountAvatar({
	account,
	size,
}: {
	account: ForgeAccount | null;
	size: "md" | "lg";
}) {
	const fallback = account?.login.slice(0, 2).toUpperCase() || "GH";

	return (
		<div
			{...stylex.props(
				styles.avatar,
				size === "lg" ? styles.avatarLg : styles.avatarMd
			)}
		>
			{account?.avatarUrl ? (
				<img
					src={account.avatarUrl}
					alt={account.login}
					{...stylex.props(styles.avatarImage)}
				/>
			) : account ? (
				fallback
			) : (
				<IconUser size={18} />
			)}
		</div>
	);
}

export function ProfileErrorBanner({ message }: { message: string }) {
	return (
		<Notice tone="warning" icon={<IconAlertTriangle size={13} />}>
			{message}
		</Notice>
	);
}

export function ProfileSuccessBanner({ message }: { message: string }) {
	return (
		<Notice tone="success" icon={<IconCheck size={13} />}>
			{message}
		</Notice>
	);
}

const styles = stylex.create({
	avatar: {
		display: "flex",
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		overflow: "hidden",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: "999px",
		backgroundColor: color.controlActive,
		color: color.textSoft,
		fontWeight: 600,
	},
	avatarMd: {
		width: "2.5rem",
		height: "2.5rem",
		fontSize: font.size_3,
	},
	avatarLg: {
		width: "2.5rem",
		height: "2.5rem",
		fontSize: "0.8125rem",
	},
	avatarImage: {
		width: "100%",
		height: "100%",
		objectFit: "cover",
	},
});
