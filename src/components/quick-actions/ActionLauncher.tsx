import * as stylex from "@stylexjs/stylex";
import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { getAgentIcon } from "../../features/agents/agent-ui.tsx";
import { getAgentDefinition } from "../../features/agents/agents.ts";
import {
	filterActionLauncherProfiles,
	moveLauncherIndex,
} from "../../features/quick-actions/action-launcher.ts";
import { launchQuickAction } from "../../features/quick-actions/launch-quick-action.ts";
import { loadQuickActions } from "../../features/quick-actions/quick-actions-store.ts";
import type { QuickActionProfile } from "../../features/quick-actions/types.ts";
import { basename } from "../../lib/format.ts";
import {
	color,
	controlSize,
	font,
	motion,
	radius,
	shadow,
} from "../../tokens.stylex.ts";
import { IconSearch, IconSend, IconX } from "../ui/Icons.tsx";

function shouldOpenLauncher(event: globalThis.KeyboardEvent): boolean {
	const mod = event.metaKey || event.ctrlKey;
	return (
		mod &&
		(event.key.toLowerCase() === "k" ||
			(event.shiftKey && event.key.toLowerCase() === "a"))
	);
}

export function ActionLauncher() {
	const navigate = useNavigate();
	const inputRef = useRef<HTMLInputElement>(null);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [profiles, setProfiles] = useState<QuickActionProfile[]>([]);
	const [activeIndex, setActiveIndex] = useState(0);
	const [launchingId, setLaunchingId] = useState<string | null>(null);

	const visibleProfiles = useMemo(
		() => filterActionLauncherProfiles(profiles, query),
		[profiles, query]
	);

	const openLauncher = useCallback(() => {
		setProfiles(loadQuickActions());
		setQuery("");
		setActiveIndex(0);
		setOpen(true);
	}, []);

	const closeLauncher = useCallback(() => {
		setOpen(false);
		setLaunchingId(null);
	}, []);

	useEffect(() => {
		const onKeyDown = (event: globalThis.KeyboardEvent) => {
			if (shouldOpenLauncher(event)) {
				event.preventDefault();
				openLauncher();
			} else if (event.key === "Escape" && open) {
				closeLauncher();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [closeLauncher, open, openLauncher]);

	useEffect(() => {
		if (!open) return;
		window.setTimeout(() => inputRef.current?.focus(), 0);
	}, [open]);

	useEffect(() => {
		if (activeIndex >= visibleProfiles.length) setActiveIndex(0);
	}, [activeIndex, visibleProfiles.length]);

	const updateQuery = (value: string) => {
		setQuery(value);
		setActiveIndex(0);
	};

	const launchProfile = useCallback(
		async (profile: QuickActionProfile) => {
			setLaunchingId(profile.id);
			try {
				await launchQuickAction(profile, navigate);
				closeLauncher();
			} catch (error) {
				alert(
					error instanceof Error ? error.message : "Unable to launch action"
				);
				setLaunchingId(null);
			}
		},
		[closeLauncher, navigate]
	);

	const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActiveIndex((index) =>
				moveLauncherIndex(index, 1, visibleProfiles.length)
			);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			setActiveIndex((index) =>
				moveLauncherIndex(index, -1, visibleProfiles.length)
			);
		} else if (event.key === "Enter") {
			event.preventDefault();
			const profile = visibleProfiles[activeIndex];
			if (profile) void launchProfile(profile);
		}
	};

	if (!open) return null;

	return (
		<div {...stylex.props(styles.backdrop)} onMouseDown={closeLauncher}>
			<section
				{...stylex.props(styles.panel)}
				onMouseDown={(event) => event.stopPropagation()}
			>
				<div {...stylex.props(styles.searchRow)}>
					<IconSearch size={14} {...stylex.props(styles.searchIcon)} />
					<input
						ref={inputRef}
						value={query}
						onChange={(event) => updateQuery(event.target.value)}
						onKeyDown={handleInputKeyDown}
						placeholder="Search automation pieces"
						{...stylex.props(styles.input)}
					/>
					<button
						type="button"
						onClick={closeLauncher}
						{...stylex.props(styles.closeButton)}
						aria-label="Close action launcher"
					>
						<IconX size={13} />
					</button>
				</div>
				<div {...stylex.props(styles.results)}>
					{visibleProfiles.length === 0 ? (
						<div {...stylex.props(styles.emptyState)}>No matching actions</div>
					) : (
						visibleProfiles.slice(0, 10).map((profile, index) => (
							<button
								type="button"
								key={profile.id}
								onMouseEnter={() => setActiveIndex(index)}
								onClick={() => void launchProfile(profile)}
								disabled={!!launchingId}
								{...stylex.props(
									styles.result,
									activeIndex === index && styles.resultActive
								)}
							>
								<span {...stylex.props(styles.agentIcon)}>
									{getAgentIcon(profile.agentKind, 13)}
								</span>
								<span {...stylex.props(styles.resultBody)}>
									<span {...stylex.props(styles.resultTitle)}>
										{profile.name}
									</span>
									<span {...stylex.props(styles.resultMeta)}>
										{getAgentDefinition(profile.agentKind).label} ·{" "}
										{profile.model}
										{profile.cwd
											? ` · ${basename(profile.cwd)}`
											: " · choose cwd"}
										{profile.useWorktree ? " · worktree" : ""}
									</span>
								</span>
								<span {...stylex.props(styles.launchHint)}>
									<IconSend size={11} />
									{launchingId === profile.id ? "Launching" : "Launch"}
								</span>
							</button>
						))
					)}
				</div>
				<div {...stylex.props(styles.footer)}>
					<span>Enter launches</span>
					<span>Esc closes</span>
				</div>
			</section>
		</div>
	);
}

const styles = stylex.create({
	backdrop: {
		alignItems: "flex-start",
		backgroundColor: "rgba(0, 0, 0, 0.46)",
		display: "flex",
		inset: 0,
		justifyContent: "center",
		paddingTop: "14vh",
		position: "fixed",
		zIndex: 100,
	},
	panel: {
		backgroundColor: color.background,
		borderColor: color.borderStrong,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.modal,
		display: "flex",
		flexDirection: "column",
		overflow: "hidden",
		width: "min(42rem, calc(100vw - 3rem))",
	},
	searchRow: {
		alignItems: "center",
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "flex",
		gap: controlSize._2,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
	},
	searchIcon: {
		color: color.textMuted,
		flexShrink: 0,
	},
	input: {
		backgroundColor: "transparent",
		borderWidth: 0,
		color: color.textMain,
		flex: 1,
		fontSize: font.size_3,
		minWidth: 0,
		outline: "none",
		"::placeholder": {
			color: color.textMuted,
			opacity: 0.6,
		},
	},
	closeButton: {
		alignItems: "center",
		backgroundColor: {
			default: "transparent",
			":hover": color.surfaceSubtle,
		},
		borderRadius: radius.md,
		color: color.textMuted,
		display: "flex",
		height: controlSize._7,
		justifyContent: "center",
		width: controlSize._7,
	},
	results: {
		maxHeight: "28rem",
		overflowY: "auto",
		padding: controlSize._2,
	},
	result: {
		alignItems: "center",
		backgroundColor: {
			default: "transparent",
			":hover": color.surfaceSubtle,
		},
		borderRadius: radius.md,
		color: color.textSoft,
		display: "grid",
		gap: controlSize._2,
		gridTemplateColumns: "auto minmax(0, 1fr) auto",
		minHeight: "3.4rem",
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._2,
		textAlign: "left",
		transitionDuration: motion.durationFast,
		transitionProperty: "background-color",
		width: "100%",
	},
	resultActive: {
		backgroundColor: color.surfaceSubtle,
	},
	agentIcon: {
		alignItems: "center",
		backgroundColor: color.backgroundRaised,
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		height: controlSize._7,
		justifyContent: "center",
		width: controlSize._7,
	},
	resultBody: {
		display: "flex",
		flexDirection: "column",
		minWidth: 0,
	},
	resultTitle: {
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	resultMeta: {
		color: color.textMuted,
		fontSize: font.size_1,
		marginTop: 2,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	launchHint: {
		alignItems: "center",
		color: color.textMuted,
		display: "inline-flex",
		fontSize: font.size_1,
		gap: controlSize._1,
		justifyContent: "flex-end",
	},
	emptyState: {
		alignItems: "center",
		color: color.textMuted,
		display: "flex",
		fontSize: font.size_2,
		justifyContent: "center",
		minHeight: "8rem",
	},
	footer: {
		alignItems: "center",
		borderTopColor: color.border,
		borderTopStyle: "solid",
		borderTopWidth: 1,
		color: color.textMuted,
		display: "flex",
		fontSize: font.size_1,
		gap: controlSize._3,
		justifyContent: "flex-end",
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
	},
});
