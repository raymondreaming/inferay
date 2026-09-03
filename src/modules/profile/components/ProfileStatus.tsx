import * as stylex from "@octanejs/stylex";
import { iconSize } from "../../../design-system.ts";
import type { ForgeAccount } from "../../../modules/repository/adapters/types.ts";
import {
	IconAlertTriangle,
	IconCheck,
	IconUser,
} from "../../../shared/ui/Icons.tsx";
import { Notice } from "../../../shared/ui/Surface.tsx";
import { color, font, radius } from "../../../tokens.stylex.ts";

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
				size === "lg" ? styles.avatarLg : styles.avatarMd,
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
				<IconUser size={iconSize._2xl} />
			)}
		</div>
	);
}

export function ProfileErrorBanner({ message }: { message: string }) {
	return (
		<Notice tone="warning" icon={<IconAlertTriangle size={iconSize._2md} />}>
			{message}
		</Notice>
	);
}

export function ProfileSuccessBanner({ message }: { message: string }) {
	return (
		<Notice tone="success" icon={<IconCheck size={iconSize._2md} />}>
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
		borderRadius: radius.pill,
		backgroundColor: color.controlActive,
		color: color.textSoft,
		fontWeight: font.weight_6,
	},
	avatarMd: {
		width: "2.5rem",
		height: "2.5rem",
		fontSize: font.size_3,
	},
	avatarLg: {
		width: "2.5rem",
		height: "2.5rem",
		fontSize: font.size_4,
	},
	avatarImage: {
		width: "100%",
		height: "100%",
		objectFit: "cover",
	},
});
