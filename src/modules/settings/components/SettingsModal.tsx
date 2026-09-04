import * as stylex from "@octanejs/stylex";
import { useEffect, useRef, useState } from "octane";
import { APP_REGION_NO_DRAG_CLASS } from "../../../app/model/appearance.ts";
import {
	breakpoint,
	color,
	controlSize,
	font,
	iconSize,
	layer,
	radius,
	shadow,
} from "../../../design-system/styles.stylex.ts";
import { listenWindowEvent } from "../../../shared/lib/react-events.ts";
import { IconButton } from "../../../shared/ui/IconButton.tsx";
import {
	IconAgent,
	IconGitBranch,
	IconLayoutGrid,
	IconSettings,
	IconSparkles,
	IconX,
} from "../../../shared/ui/Icons.tsx";
import {
	OPEN_SETTINGS_MODAL_EVENT,
	type OpenSettingsModalDetail,
	type SettingsModalTarget,
} from "../model/settings-events.ts";
import { SettingsModalContent } from "./SettingsModalContent.tsx";

const SETTINGS_SECTIONS = [
	{
		id: "agents",
		label: "Agents",
		description: "Defaults for new conversations and global instructions.",
		icon: IconAgent,
	},
	{
		id: "appearance",
		label: "Appearance",
		description: "Theme, type, background, and code presentation.",
		icon: IconSparkles,
	},
	{
		id: "workspace",
		label: "Workspace",
		description: "Pane layout and project search locations.",
		icon: IconLayoutGrid,
	},
	{
		id: "github",
		label: "GitHub",
		description: "Connected accounts, repository access, and cloning.",
		icon: IconGitBranch,
	},
] as const satisfies ReadonlyArray<{
	id: SettingsModalTarget;
	label: string;
	description: string;
	icon: typeof IconAgent;
}>;

export function SettingsModalHost() {
	const [open, setOpen] = useState(false);
	const [activeSection, setActiveSection] =
		useState<SettingsModalTarget>("agents");
	const contentRef = useRef<HTMLDivElement | null>(null);
	const activePage =
		SETTINGS_SECTIONS.find((section) => section.id === activeSection) ??
		SETTINGS_SECTIONS[0];

	useEffect(
		() =>
			listenWindowEvent(OPEN_SETTINGS_MODAL_EVENT, (event) => {
				const requestedSection = (event as CustomEvent<OpenSettingsModalDetail>)
					.detail?.section;
				setActiveSection(
					SETTINGS_SECTIONS.some((section) => section.id === requestedSection)
						? requestedSection
						: "agents",
				);
				setOpen(true);
			}),
		[],
	);
	useEffect(() => {
		if (!open) return;
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		window.addEventListener("keydown", closeOnEscape);
		return () => window.removeEventListener("keydown", closeOnEscape);
	}, [open]);

	if (!open) return null;
	const modalProps = stylex.props(styles.modal);
	const backdropProps = stylex.props(styles.backdrop);

	return (
		<div
			role="presentation"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) setOpen(false);
			}}
			{...backdropProps}
			style={{
				boxSizing: "border-box",
				display: "grid",
				inset: 0,
				padding: 24,
				placeItems: "center",
				position: "fixed",
			}}
		>
			<section
				role="dialog"
				aria-modal="true"
				aria-labelledby="settings-modal-title"
				{...modalProps}
				className={`${APP_REGION_NO_DRAG_CLASS} ${modalProps.className ?? ""}`}
				style={{
					display: "grid",
					gridTemplateColumns: "clamp(60px, 20vw, 184px) minmax(0, 1fr)",
					height: "min(672px, calc(100vh - 48px))",
					maxHeight: "calc(100vh - 48px)",
					maxWidth: "calc(100vw - 48px)",
					overflow: "hidden",
					width: "min(928px, calc(100vw - 48px))",
				}}
			>
				<aside {...stylex.props(styles.sidebar)}>
					<div {...stylex.props(styles.brand)}>
						<span {...stylex.props(styles.brandIcon)}>
							<IconSettings size={iconSize.md} />
						</span>
						<strong {...stylex.props(styles.brandTitle)}>Settings</strong>
					</div>
					<nav aria-label="Settings sections" {...stylex.props(styles.nav)}>
						{SETTINGS_SECTIONS.map((section) => {
							const SectionIcon = section.icon;
							const selected = section.id === activeSection;
							return (
								<button
									key={section.id}
									type="button"
									aria-current={selected ? "page" : undefined}
									onClick={() => {
										setActiveSection(section.id);
										if (contentRef.current) contentRef.current.scrollTop = 0;
									}}
									{...stylex.props(
										styles.navItem,
										selected && styles.navItemSelected,
									)}
								>
									<SectionIcon size={iconSize.md} />
									<span>{section.label}</span>
								</button>
							);
						})}
					</nav>
				</aside>
				<div {...stylex.props(styles.main)}>
					<header {...stylex.props(styles.header)}>
						<div {...stylex.props(styles.heading)}>
							<h1 id="settings-modal-title" {...stylex.props(styles.title)}>
								{activePage.label}
							</h1>
							<p {...stylex.props(styles.subtitle)}>{activePage.description}</p>
						</div>
						<IconButton
							type="button"
							onClick={() => setOpen(false)}
							variant="ghost"
							size="sm"
							title="Close settings"
							aria-label="Close settings"
						>
							<IconX size={iconSize.md} />
						</IconButton>
					</header>
					<div ref={contentRef} {...stylex.props(styles.content)}>
						<SettingsModalContent section={activeSection} />
					</div>
				</div>
			</section>
		</div>
	);
}

const styles = stylex.create({
	backdrop: {
		backdropFilter: "blur(14px)",
		backgroundColor: "rgba(0, 0, 0, 0.64)",
		display: "grid",
		inset: controlSize._0,
		overflow: "hidden",
		placeItems: "center",
		position: "fixed",
		zIndex: layer.criticalOverlay,
	},
	modal: {
		backgroundColor: color.backgroundModal,
		borderColor: color.borderStrong,
		borderRadius: radius._2xl,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.modal,
		display: "grid",
		gridTemplateColumns: {
			default: "3.75rem minmax(0, 1fr)",
			[breakpoint.tablet]: "11.5rem minmax(0, 1fr)",
		},
		height: "min(42rem, calc(100dvh - 3rem))",
		maxHeight: "calc(100dvh - 3rem)",
		maxWidth: "calc(100dvw - 3rem)",
		overflow: "hidden",
		width: "min(58rem, calc(100dvw - 3rem))",
	},
	sidebar: {
		backgroundColor: color.surfaceWhite025,
		borderRightColor: color.border,
		borderRightStyle: "solid",
		borderRightWidth: 1,
		display: "flex",
		flexDirection: "column",
		minHeight: controlSize._0,
		padding: controlSize._3,
	},
	brand: {
		alignItems: "center",
		display: "flex",
		gap: controlSize._2,
		height: controlSize._10,
		paddingInline: controlSize._2,
	},
	brandIcon: {
		alignItems: "center",
		color: color.textSoft,
		display: "inline-flex",
		flexShrink: 0,
		justifyContent: "center",
	},
	brandTitle: {
		color: color.textMain,
		fontSize: font.size_3,
		fontWeight: font.weight_6,
		display: {
			default: "none",
			[breakpoint.tablet]: "inline",
		},
	},
	nav: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		marginTop: controlSize._3,
	},
	navItem: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceWhite04,
		},
		borderRadius: radius.md,
		color: color.textMuted,
		display: "flex",
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		gap: controlSize._2,
		height: controlSize._9,
		justifyContent: {
			default: "center",
			[breakpoint.tablet]: "flex-start",
		},
		paddingInline: controlSize._2,
		textAlign: "left",
		width: "100%",
	},
	navItemSelected: {
		backgroundColor: color.surfaceWhite075,
		color: color.textMain,
	},
	main: {
		display: "flex",
		flexDirection: "column",
		minHeight: controlSize._0,
		minWidth: controlSize._0,
	},
	header: {
		alignItems: "center",
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "flex",
		flexShrink: 0,
		justifyContent: "space-between",
		minHeight: controlSize._16,
		paddingBlock: controlSize._3,
		paddingInline: controlSize._6,
	},
	heading: {
		minWidth: controlSize._0,
	},
	title: {
		color: color.textMain,
		fontSize: font.size_4,
		fontWeight: font.weight_6,
		letterSpacing: "-0.008em",
		margin: controlSize._0,
	},
	subtitle: {
		color: color.textMuted,
		fontSize: font.size_1,
		marginBlockEnd: controlSize._0,
		marginBlockStart: controlSize._0_5,
	},
	content: {
		flex: 1,
		minHeight: controlSize._0,
		overscrollBehavior: "contain",
		overflowY: "auto",
	},
});
