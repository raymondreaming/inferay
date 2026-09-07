import { Dynamic } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import {
	createEffect,
	createMemo,
	createSignal,
	Loading,
	onSettled,
	Show,
} from "solid-js";
import { APP_REGION_NO_DRAG_CLASS } from "../../../../app/hooks/useAppAppearance.tsx";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import {
	ariaValue,
	domStyle,
	listenWindowEvent,
	OPEN_SETTINGS_MODAL_EVENT,
	type OpenSettingsModalDetail,
	type SettingsModalTarget,
} from "../../../../shared/lib/dom.tsx";
import { IconButton } from "../../../../shared/ui/IconButton/index.tsx";
import {
	IconAgent,
	IconGitBranch,
	IconLayoutGrid,
	IconSettings,
	IconSparkles,
	IconX,
} from "../../../../shared/ui/Icons/index.tsx";
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
	const [open, setOpen] = createSignal(false);
	const [activeSection, setActiveSection] =
		createSignal<SettingsModalTarget>("agents");
	const contentRef = {
		current: null,
	} as {
		current: HTMLDivElement | null;
	};
	const activePage = createMemo(
		() =>
			SETTINGS_SECTIONS.find((section) => section.id === activeSection()) ??
			SETTINGS_SECTIONS[0],
	);
	onSettled(() => {
		return listenWindowEvent(OPEN_SETTINGS_MODAL_EVENT, (event) => {
			const requestedSection = (event as CustomEvent<OpenSettingsModalDetail>)
				.detail?.section;
			setActiveSection(
				SETTINGS_SECTIONS.some((section) => section.id === requestedSection)
					? requestedSection
					: "agents",
			);
			setOpen(true);
		});
	});
	createEffect(
		() => [open()],
		() => {
			if (!open()) return;
			const closeOnEscape = (event: KeyboardEvent) => {
				if (event.key === "Escape") setOpen(false);
			};
			window.addEventListener("keydown", closeOnEscape);
			return () => window.removeEventListener("keydown", closeOnEscape);
		},
	);
	const modalProps = stylex.attrs(styles.modal);
	const backdropProps = stylex.attrs(styles.backdrop);
	return (
		<Show when={open()}>
			<div
				role="presentation"
				onMouseDown={(event) => {
					if (event.target === event.currentTarget) setOpen(false);
				}}
				{...backdropProps}
				style={domStyle(inlineStyles.getSettingsModalHostDivStyle())}
			>
				<section
					role="dialog"
					aria-modal="true"
					aria-labelledby="settings-modal-title"
					{...modalProps}
					class={`${APP_REGION_NO_DRAG_CLASS} ${modalProps.class ?? ""}`}
					style={domStyle(inlineStyles.getSettingsModalHostSectionStyle())}
				>
					<aside {...stylex.attrs(styles.sidebar)}>
						<div {...stylex.attrs(styles.brand)}>
							<span {...stylex.attrs(styles.brandIcon)}>
								<IconSettings size={iconSize.md} />
							</span>
							<strong {...stylex.attrs(styles.brandTitle)}>Settings</strong>
						</div>
						<nav aria-label="Settings sections" {...stylex.attrs(styles.nav)}>
							{SETTINGS_SECTIONS.map((section) => {
								const SectionIcon = createMemo(() => section.icon);
								const selected = createMemo(
									() => section.id === activeSection(),
								);
								return (
									<button
										type="button"
										aria-current={ariaValue(selected() ? "page" : undefined)}
										onClick={() => {
											setActiveSection(section.id);
											if (contentRef.current) contentRef.current.scrollTop = 0;
										}}
										{...stylex.attrs(
											styles.navItem,
											selected() && styles.navItemSelected,
										)}
									>
										<Dynamic component={SectionIcon()} size={iconSize.md} />
										<span>{section.label}</span>
									</button>
								);
							})}
						</nav>
					</aside>
					<div {...stylex.attrs(styles.main)}>
						<header {...stylex.attrs(styles.header)}>
							<div {...stylex.attrs(styles.heading)}>
								<h1 id="settings-modal-title" {...stylex.attrs(styles.title)}>
									{activePage().label}
								</h1>
								<p {...stylex.attrs(styles.subtitle)}>
									{activePage().description}
								</p>
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
						<div
							ref={(element) => (contentRef.current = element)}
							{...stylex.attrs(styles.content)}
						>
							<Loading fallback={<p role="status">Loading settings…</p>}>
								<SettingsModalContent section={activeSection()} />
							</Loading>
						</div>
					</div>
				</section>
			</div>
		</Show>
	);
}
