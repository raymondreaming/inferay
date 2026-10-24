import { DatabaseExplorer } from "@database/components/DatabaseExplorer/index.tsx";
import { iconSize } from "@design-system/styles.stylex.ts";
import {
	APP_REGION_DRAG_CLASS,
	APP_REGION_NO_DRAG_CLASS,
	ariaValue,
	listenWindowEvent,
	OPEN_SETTINGS_EVENT,
	type OpenSettingsDetail,
	type SettingsTarget,
	setInputValue,
} from "@shared/lib/dom.tsx";
import { ErrorBoundary } from "@shared/ui/ErrorBoundary/index.tsx";
import { IconButton } from "@shared/ui/IconButton/index.tsx";
import {
	IconAgent,
	IconArrowLeft,
	IconGitBranch,
	IconLayoutGrid,
	IconSearch,
	IconSparkles,
} from "@shared/ui/Icons/index.tsx";
import { TextInput } from "@shared/ui/TextInput/index.tsx";
import { SkillsPage } from "@skills/components/SkillsPage/index.tsx";
import { Dynamic } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import {
	createMemo,
	createSignal,
	type Element,
	For,
	Loading,
	onSettled,
	Show,
} from "solid-js";
import { SettingsContent } from "../SettingsContent/index.tsx";
import { styles } from "./styles.ts";

const SECTIONS = [
	{
		id: "database",
		group: "App",
		label: "Database",
		icon: IconLayoutGrid,
		description:
			"Explore local tables, records, and the schema that connects them.",
		keywords: "data sqlite storage schema rows indexes",
	},
	{
		id: "appearance",
		group: "App",
		label: "Appearance",
		icon: IconSparkles,
		description: "Make Inferay feel at home on your desktop.",
		keywords: "background glass font theme colors text code",
	},
	{
		id: "github",
		group: "App",
		label: "GitHub",
		icon: IconGitBranch,
		description: "Connect your account and manage GitHub access.",
		keywords: "account authentication connection git",
	},
	{
		id: "agents",
		group: "Agents",
		label: "Providers",
		icon: IconAgent,
		description: "Configure your agents and the defaults for new chats.",
		keywords: "model reasoning instructions codex claude gemini",
	},
	{
		id: "mcp",
		group: "Agents",
		label: "MCP connections",
		icon: IconAgent,
		description: "Manage the tools and services available to your agents.",
		keywords: "servers tools integrations",
	},
	{
		id: "skills",
		group: "Agents",
		label: "Skills",
		icon: IconSparkles,
		description:
			"Reusable instructions for your agents, available in every project.",
		keywords: "library workflow commands create edit new instructions",
	},
	{
		id: "workspace",
		group: "Workspace",
		label: "Folders",
		icon: IconLayoutGrid,
		description: "Choose where Inferay looks for your repositories.",
		keywords: "workspace projects directories search",
	},
] as const;

export function SettingsPageHost(props: { children?: Element }) {
	const [open, setOpen] = createSignal(false);
	const [query, setQuery] = createSignal("");
	const [history, setHistory] = createSignal<{
		pages: OpenSettingsDetail[];
		index: number;
	}>({ pages: [{ section: "agents" }], index: 0 });
	const currentPage = () => history().pages[history().index]!;
	const activeSection = () => currentPage().section;
	const activePage = createMemo(() =>
		SECTIONS.find((section) => section.id === activeSection())!,
	);
	const matchingSections = createMemo(() => {
		const needle = query().trim().toLowerCase();
		return SECTIONS.filter((section) =>
			`${section.label} ${section.group} ${section.keywords}`
				.toLowerCase()
				.includes(needle),
		);
	});
	let content: HTMLElement | undefined;
	let previousFocus: HTMLElement | null = null;
	let leaveGuard: ((proceed: () => void) => void) | null = null;
	const leave = (proceed: () => void) => {
		if (leaveGuard) leaveGuard(proceed);
		else proceed();
	};
	const close = () =>
		leave(() => {
			setOpen(false);
			requestAnimationFrame(() => {
				if (previousFocus?.isConnected)
					previousFocus.focus({ preventScroll: true });
			});
		});
	const navigate = (section: SettingsTarget) => {
		if (section === activeSection()) return;
		leave(() => {
			setHistory((current) => ({
				pages: [...current.pages.slice(0, current.index + 1), { section }],
				index: current.index + 1,
			}));
			if (content) content.scrollTop = 0;
		});
	};
	const back = () => {
		if (!history().index) {
			close();
			return;
		}
		leave(() => {
			setHistory((current) => ({ ...current, index: current.index - 1 }));
			if (content) content.scrollTop = 0;
		});
	};
	onSettled(() =>
		listenWindowEvent(OPEN_SETTINGS_EVENT, (event) =>
			leave(() => {
				const detail = (event as CustomEvent<OpenSettingsDetail>).detail;
				const requested = detail?.section;
				const section = SECTIONS.some((item) => item.id === requested)
					? requested
					: "agents";
				if (!open())
					previousFocus =
						document.activeElement instanceof HTMLElement
							? document.activeElement
							: null;
				setHistory({ pages: [{ section, skills: detail?.skills }], index: 0 });
				setQuery("");
				setOpen(true);
			}),
		),
	);
	onSettled(() =>
		listenWindowEvent("keydown", (event) => {
			if (
				open() &&
				event.key === "Escape" &&
				!event.defaultPrevented &&
				!document.querySelector('dialog[open], [role="dialog"], [role="menu"]')
			) {
				event.preventDefault();
				close();
			}
		}),
	);
	return (
		<>
			<div
				inert={open()}
				{...stylex.attrs(styles.workspace)}
				style={{ visibility: open() ? "hidden" : "visible" }}
			>
				{props.children}
			</div>
			<Show when={open()}>
				<section
					data-settings-page
					aria-label="Settings"
					{...stylex.attrs(styles.root)}
				>
					<header
						class={`${APP_REGION_DRAG_CLASS} ${stylex.attrs(styles.header).class ?? ""}`}
					>
						<div
							class={`${APP_REGION_NO_DRAG_CLASS} ${stylex.attrs(styles.navigation).class ?? ""}`}
						>
							<IconButton
								aria-label={
									history().index
										? "Previous settings page"
										: "Back to workspace"
								}
								title={
									history().index
										? "Previous settings page"
										: "Back to workspace (Esc)"
								}
								onClick={back}
							>
								<IconArrowLeft size={iconSize.sm} />
							</IconButton>
							<IconButton
								aria-label="Next settings page"
								title="Next settings page"
								disabled={history().index === history().pages.length - 1}
								onClick={() =>
									leave(() => {
										setHistory((current) => ({
											...current,
											index: current.index + 1,
										}));
										if (content) content.scrollTop = 0;
									})
								}
							>
								<IconArrowLeft
									size={iconSize.sm}
									{...stylex.attrs(styles.forward)}
								/>
							</IconButton>
						</div>
						<div
							aria-label="Settings location"
							{...stylex.attrs(styles.breadcrumb)}
						>
							<span>Settings</span>
							<span>/</span>
							<span {...stylex.attrs(styles.current)}>
								{activePage().label}
							</span>
						</div>
						<div
							class={`${APP_REGION_NO_DRAG_CLASS} ${stylex.attrs(styles.searchWrap).class ?? ""}`}
						>
							<IconSearch
								size={iconSize.sm}
								{...stylex.attrs(styles.searchIcon)}
							/>
							<TextInput
								type="search"
								size="sm"
								fullWidth
								autofocus
								value={query()}
								onInput={setInputValue.bind(null, setQuery)}
								placeholder="Search settings"
								aria-label="Search settings"
								class={stylex.attrs(styles.searchInput).class}
							/>
						</div>
					</header>
					<aside {...stylex.attrs(styles.sidebar)}>
						<nav aria-label="Settings sections" {...stylex.attrs(styles.nav)}>
							<For
								each={["App", "Agents", "Workspace"]}
								keyed={(group) => group}
							>
								{(group) => (
									<Show
										when={matchingSections().some(
											(section) => section.group === group(),
										)}
									>
										<div {...stylex.attrs(styles.navGroup)}>
											<span {...stylex.attrs(styles.navGroupLabel)}>
												{group()}
											</span>
											<For
												each={matchingSections().filter(
													(section) => section.group === group(),
												)}
												keyed={(section) => section.id}
											>
												{(section) => (
													<button
														type="button"
														aria-current={ariaValue(
															section().id === activeSection()
																? "page"
																: undefined,
														)}
														onClick={() => navigate(section().id)}
														{...stylex.attrs(
															styles.navItem,
															section().id === activeSection() &&
																styles.navItemSelected,
														)}
													>
														<Dynamic
															component={section().icon}
															size={iconSize.sm}
														/>
														<span>{section().label}</span>
													</button>
												)}
											</For>
										</div>
									</Show>
								)}
							</For>
							<Show when={!matchingSections().length}>
								<span {...stylex.attrs(styles.navGroupLabel)}>
									No matching settings
								</span>
							</Show>
						</nav>
						<button
							type="button"
							onClick={close}
							{...stylex.attrs(styles.navItem)}
						>
							<IconArrowLeft size={iconSize.sm} />
							Back to workspace
						</button>
					</aside>
					<main
						ref={(element) => {
							content = element;
						}}
						{...stylex.attrs(styles.content)}
					>
						<div
							{...stylex.attrs(styles.page)}
							style={{
								"max-width":
									activeSection() === "database" ? "1600px" : undefined,
							}}
						>
							<div {...stylex.attrs(styles.pageHeading)}>
								<h1 {...stylex.attrs(styles.pageTitle)}>
									{activePage().label}
								</h1>
								<p {...stylex.attrs(styles.description)}>
									{activePage().description}
								</p>
							</div>
							<Show when={currentPage()} keyed>
								{(page) => (
									<ErrorBoundary label="Settings" contained>
										<Loading fallback={<p role="status">Loading settings…</p>}>
											{page.section === "skills" ? (
												<SkillsPage
													target={page.skills ?? { mode: "browse" }}
													setLeaveGuard={(guard) => {
														leaveGuard = guard;
													}}
												/>
											) : page.section === "database" ? (
												<DatabaseExplorer />
											) : (
												<SettingsContent section={page.section} />
											)}
										</Loading>
									</ErrorBoundary>
								)}
							</Show>
						</div>
					</main>
				</section>
			</Show>
		</>
	);
}
