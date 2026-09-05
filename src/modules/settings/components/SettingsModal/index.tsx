import * as stylex from "@octanejs/stylex";
import { useEffect, useRef, useState } from "octane";
import { APP_REGION_NO_DRAG_CLASS } from "../../../../app/model/appearance.ts";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { listenWindowEvent } from "../../../../shared/lib/react-events.ts";
import { IconButton } from "../../../../shared/ui/IconButton/index.tsx";
import {
	IconAgent,
	IconGitBranch,
	IconLayoutGrid,
	IconSettings,
	IconSparkles,
	IconX,
} from "../../../../shared/ui/Icons/index.tsx";
import {
	OPEN_SETTINGS_MODAL_EVENT,
	type OpenSettingsModalDetail,
	type SettingsModalTarget,
} from "../../model/settings-events.ts";
import { SettingsModalContent } from "../SettingsModalContent/index.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

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
			style={inlineStyles.getSettingsModalHostDivStyle()}
		>
			<section
				role="dialog"
				aria-modal="true"
				aria-labelledby="settings-modal-title"
				{...modalProps}
				className={`${APP_REGION_NO_DRAG_CLASS} ${modalProps.className ?? ""}`}
				style={inlineStyles.getSettingsModalHostSectionStyle()}
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
