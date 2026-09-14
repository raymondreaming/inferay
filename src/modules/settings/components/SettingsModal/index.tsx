import { iconSize } from "@design-system/styles.stylex.ts";
import {
	ariaValue,
	listenWindowEvent,
	OPEN_SETTINGS_MODAL_EVENT,
	type OpenSettingsModalDetail,
	type SettingsModalTarget,
	setInputValue,
} from "@shared/lib/dom.tsx";
import { ErrorBoundary } from "@shared/ui/ErrorBoundary/index.tsx";
import {
	IconAgent,
	IconGitBranch,
	IconLayoutGrid,
	IconSearch,
	IconSparkles,
} from "@shared/ui/Icons/index.tsx";
import { Modal } from "@shared/ui/Modal/index.tsx";
import { Dynamic } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import {
	createMemo,
	createSignal,
	For,
	Loading,
	onSettled,
	Show,
} from "solid-js";
import { SettingsModalContent } from "../SettingsModalContent/index.tsx";
import { styles } from "./styles.ts";

interface SettingsNavItem {
	id: SettingsModalTarget;
	label: string;
	icon: typeof IconAgent;
}
const SETTINGS_SECTIONS = [
	{ id: "agents", label: "Agents", icon: IconAgent },
	{ id: "mcp", label: "MCP connections", icon: IconAgent },
	{ id: "workspace", label: "Workspace", icon: IconLayoutGrid },
	{ id: "github", label: "GitHub", icon: IconGitBranch },
	{ id: "appearance", label: "Appearance", icon: IconSparkles },
] as const satisfies readonly SettingsNavItem[];
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
	const matchingSections = createMemo(() => {
		const needle = query().trim().toLowerCase();
		return SETTINGS_SECTIONS.filter((section) =>
			section.label.toLowerCase().includes(needle),
		);
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
	return (
		<Show when={open()}>
			<Modal
				label="Settings"
				onClose={() => setOpen(false)}
				class={stylex.attrs(styles.modal).class}
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
						<span {...stylex.attrs(styles.navGroupLabel)}>Settings</span>
						<For each={matchingSections()} keyed={(row) => row.id}>
							{(section) => {
								const selected = createMemo(
									() => section().id === activeSection(),
								);
								return (
									<button
										type="button"
										aria-current={ariaValue(selected() ? "page" : undefined)}
										onClick={() => {
											setActiveSection(section().id);
											if (contentRef.current) contentRef.current.scrollTop = 0;
										}}
										{...stylex.attrs(
											styles.navItem,
											selected() && styles.navItemSelected,
										)}
									>
										<Dynamic component={section().icon} size={iconSize.md} />
										<span {...stylex.attrs(styles.navLabel)}>
											{section().label}
										</span>
									</button>
								);
							}}
						</For>
						{matchingSections().length === 0 ? (
							<span {...stylex.attrs(styles.navEmpty)}>No matches</span>
						) : null}
					</nav>
				</aside>
				<div {...stylex.attrs(styles.main)}>
					<div
						ref={(element) => (contentRef.current = element)}
						{...stylex.attrs(styles.content)}
					>
						<div {...stylex.attrs(styles.page)}>
							<h1 id="settings-modal-title" {...stylex.attrs(styles.pageTitle)}>
								{activePage().label}
							</h1>
							<Show when={activeSection()} keyed>
								{(section) => (
									<ErrorBoundary label="Settings" contained>
										<Loading fallback={<p role="status">Loading settings…</p>}>
											<SettingsModalContent section={section} />
										</Loading>
									</ErrorBoundary>
								)}
							</Show>
						</div>
					</div>
				</div>
			</Modal>
		</Show>
	);
}
