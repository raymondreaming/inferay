import { iconSize, surfaceStyles } from "@design-system/styles.stylex.ts";
import {
	APP_REGION_NO_DRAG_CLASS,
	ariaValue,
	domStyle,
	listenWindowEvent,
	OPEN_SETTINGS_MODAL_EVENT,
	type OpenSettingsModalDetail,
	type SettingsModalTarget,
	setInputValue,
} from "@shared/lib/dom.tsx";
import { ErrorBoundary } from "@shared/ui/ErrorBoundary/index.tsx";
import { IconButton } from "@shared/ui/IconButton/index.tsx";
import {
	IconAgent,
	IconGitBranch,
	IconLayoutGrid,
	IconSearch,
	IconSparkles,
	IconX,
} from "@shared/ui/Icons/index.tsx";
import { Dynamic } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	Loading,
	onSettled,
	Show,
} from "solid-js";
import { SettingsModalContent } from "../SettingsModalContent/index.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

interface SettingsNavItem {
	id: SettingsModalTarget;
	label: string;
	icon: typeof IconAgent;
}
interface SettingsNavGroup {
	id: string;
	label: string;
	sections: readonly SettingsNavItem[];
}
const SETTINGS_GROUPS = [
	{
		id: "workspace-group",
		label: "Settings",
		sections: [
			{
				id: "agents",
				label: "Agents",
				icon: IconAgent,
			},
			{
				id: "workspace",
				label: "Workspace",
				icon: IconLayoutGrid,
			},
			{
				id: "github",
				label: "GitHub",
				icon: IconGitBranch,
			},
		],
	},
	{
		id: "customize-group",
		label: "Customize",
		sections: [
			{
				id: "appearance",
				label: "Appearance",
				icon: IconSparkles,
			},
		],
	},
] as const satisfies ReadonlyArray<SettingsNavGroup>;
const SETTINGS_SECTIONS: readonly SettingsNavItem[] = SETTINGS_GROUPS.flatMap(
	(group) => group.sections as readonly SettingsNavItem[],
);
export function SettingsModalHost() {
	const [open, setOpen] = createSignal(false);
	const [query, setQuery] = createSignal("");
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
	const matchingGroups = createMemo<readonly SettingsNavGroup[]>(() => {
		const needle = query().trim().toLowerCase();
		return SETTINGS_GROUPS.map((group) => ({
			id: group.id,
			label: group.label,
			sections: (group.sections as readonly SettingsNavItem[]).filter(
				(section) => !needle || section.label.toLowerCase().includes(needle),
			),
		})).filter((group) => group.sections.length > 0);
	});
	onSettled(() => {
		return listenWindowEvent(OPEN_SETTINGS_MODAL_EVENT, (event) => {
			const requestedSection = (event as CustomEvent<OpenSettingsModalDetail>)
				.detail?.section;
			setActiveSection(
				SETTINGS_SECTIONS.some((section) => section.id === requestedSection)
					? requestedSection
					: "agents",
			);
			setQuery("");
			setOpen(true);
		});
	});
	createEffect(open, (isOpen) => {
		if (!isOpen) return;
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		window.addEventListener("keydown", closeOnEscape);
		return () => window.removeEventListener("keydown", closeOnEscape);
	});
	const modalProps = stylex.attrs(surfaceStyles.overlay, styles.modal);
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
						<div {...stylex.attrs(styles.searchWrap)}>
							<IconSearch
								size={iconSize.md}
								{...stylex.attrs(styles.searchIcon)}
							/>
							<input
								type="search"
								value={query()}
								onInput={setInputValue.bind(null, setQuery)}
								placeholder="Search"
								aria-label="Search settings"
								{...stylex.attrs(styles.searchInput)}
							/>
						</div>
						<nav aria-label="Settings sections" {...stylex.attrs(styles.nav)}>
							<For each={matchingGroups()} keyed={(row) => row.id}>
								{(group) => (
									<div {...stylex.attrs(styles.navGroup)}>
										<span {...stylex.attrs(styles.navGroupLabel)}>
											{group().label}
										</span>
										<For each={group().sections} keyed={(row) => row.id}>
											{(section) => {
												const selected = createMemo(
													() => section().id === activeSection(),
												);
												return (
													<button
														type="button"
														aria-current={ariaValue(
															selected() ? "page" : undefined,
														)}
														onClick={() => {
															setActiveSection(section().id);
															if (contentRef.current)
																contentRef.current.scrollTop = 0;
														}}
														{...stylex.attrs(
															styles.navItem,
															selected() && styles.navItemSelected,
														)}
													>
														<Dynamic
															component={section().icon}
															size={iconSize.md}
														/>
														<span {...stylex.attrs(styles.navLabel)}>
															{section().label}
														</span>
													</button>
												);
											}}
										</For>
									</div>
								)}
							</For>
							{matchingGroups().length === 0 ? (
								<span {...stylex.attrs(styles.navEmpty)}>No matches</span>
							) : null}
						</nav>
					</aside>
					<div {...stylex.attrs(styles.main)}>
						<IconButton
							type="button"
							onClick={() => setOpen(false)}
							variant="ghost"
							size="sm"
							title="Close settings"
							aria-label="Close settings"
							class={stylex.attrs(styles.close).class}
						>
							<IconX size={iconSize.md} />
						</IconButton>
						<div
							ref={(element) => (contentRef.current = element)}
							{...stylex.attrs(styles.content)}
						>
							<div {...stylex.attrs(styles.page)}>
								<h1
									id="settings-modal-title"
									{...stylex.attrs(styles.pageTitle)}
								>
									{activePage().label}
								</h1>
								<Show when={activeSection()} keyed>
									{(section) => (
										<ErrorBoundary label="Settings" contained>
											<Loading
												fallback={<p role="status">Loading settings…</p>}
											>
												<SettingsModalContent section={section} />
											</Loading>
										</ErrorBoundary>
									)}
								</Show>
							</div>
						</div>
					</div>
				</section>
			</div>
		</Show>
	);
}
