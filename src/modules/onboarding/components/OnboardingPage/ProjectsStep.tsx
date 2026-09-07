import * as stylex from "@stylexjs/stylex";
import { createMemo, For } from "solid-js";
import type { GithubRepo } from "../../../../../build/presentation/contracts/GithubRepo.ts";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { ariaValue } from "../../../../shared/lib/dom.tsx";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import { IconButton } from "../../../../shared/ui/IconButton/index.tsx";
import {
	IconArrowLeft,
	IconCheck,
	IconChevronRight,
	IconFolder,
	IconFolderOpen,
	IconGlobe,
	IconRefreshCw,
	IconX,
} from "../../../../shared/ui/Icons/index.tsx";
import { getStepPhase, type Step } from "../../hooks/useOnboardingStep.tsx";
import { styles } from "./styles.ts";
export function ProjectsStep(_props: {
	step: Step;
	repos: GithubRepo[];
	reposLoading: boolean;
	hasGithub: boolean;
	selected: Set<string>;
	onToggle: (fullName: string) => void;
	onRefreshRepos: () => void;
	localFolders: string[];
	isAddingFolder: boolean;
	onPickFolder: () => void;
	onRemoveFolder: (folder: string) => void;
	onBack: () => void;
	onComplete: () => void;
}) {
	const totalProjects = createMemo(
		() => _props.selected.size + _props.localFolders.length,
	);
	const phase = createMemo(() => getStepPhase(_props.step, "projects"));
	return (
		<section
			aria-hidden={ariaValue(_props.step !== "projects")}
			{...stylex.attrs(
				styles.stepSurface,
				styles.stepSurfaceSlow,
				phase() === "active" && styles.stepActive,
				phase() === "before" && styles.forwardBefore,
				phase() === "after" && styles.projectsAfter,
			)}
		>
			<div {...stylex.attrs(styles.projectPanel)}>
				<div {...stylex.attrs(styles.centerText)}>
					<h2 {...stylex.attrs(styles.stepTitle)}>Bring in your projects</h2>
					<p {...stylex.attrs(styles.stepDescription)}>
						Start with a local folder or select repositories from GitHub. You
						can add more anytime.
					</p>
				</div>

				<div {...stylex.attrs(styles.actionCards)}>
					<button
						type="button"
						onClick={_props.onPickFolder}
						disabled={_props.isAddingFolder}
						{...stylex.attrs(styles.projectActionCard)}
					>
						<div {...stylex.attrs(styles.projectActionIcon)}>
							<IconFolderOpen size={iconSize._3xl} />
						</div>
						<div {...stylex.attrs(styles.projectActionTitle)}>
							Choose local project
						</div>
						<p {...stylex.attrs(styles.projectActionText)}>
							Add a folder already on this machine.
						</p>
					</button>
					<button
						type="button"
						onClick={_props.hasGithub ? _props.onRefreshRepos : undefined}
						disabled={!_props.hasGithub || _props.reposLoading}
						{...stylex.attrs(styles.projectActionCard)}
					>
						<div {...stylex.attrs(styles.projectActionIcon)}>
							<IconGlobe size={iconSize._3xl} />
						</div>
						<div {...stylex.attrs(styles.projectActionTitle)}>
							Import from GitHub
						</div>
						<p {...stylex.attrs(styles.projectActionText)}>
							{_props.hasGithub
								? "Select from your repositories below."
								: "Connect GitHub first to browse repos."}
						</p>
					</button>
				</div>

				{/* Added projects list */}
				<div {...stylex.attrs(styles.projectListSection)}>
					<div {...stylex.attrs(styles.listMeta)}>
						<span>
							{_props.hasGithub && _props.repos.length > 0
								? "Your repositories"
								: _props.localFolders.length > 0
									? "Added projects"
									: "Projects"}
						</span>
						{totalProjects() > 0 && <span>{totalProjects()}</span>}
					</div>
					<div {...stylex.attrs(styles.projectList)}>
						{
							<For each={_props.localFolders} keyed={(row) => row}>
								{(folder) => (
									<div {...stylex.attrs(styles.localFolderRow)}>
										<IconFolder
											size={iconSize.lg}
											{...stylex.attrs(styles.mutedIcon, styles.shrink)}
										/>
										<div {...stylex.attrs(styles.rowText)}>
											<p {...stylex.attrs(styles.repoName)}>{folder()}</p>
										</div>
										<IconButton
											type="button"
											onClick={() => _props.onRemoveFolder(folder())}
											variant="danger"
											size="xs"
										>
											<IconX size={iconSize.lg} />
										</IconButton>
									</div>
								)}
							</For>
						}

						{_props.hasGithub && _props.reposLoading ? (
							<div {...stylex.attrs(styles.loadingState)}>
								<IconRefreshCw
									size={iconSize._2md}
									{...stylex.attrs(styles.spinIcon)}
								/>
								Loading repositories…
							</div>
						) : _props.hasGithub && _props.repos.length > 0 ? (
							<For each={_props.repos} keyed={(row) => row.full_name}>
								{(repo) => {
									const isSelected = createMemo(() =>
										_props.selected.has(repo().full_name),
									);
									return (
										<button
											type="button"
											onClick={() => _props.onToggle(repo().full_name)}
											{...stylex.attrs(
												styles.repoRow,
												isSelected() && styles.repoRowSelected,
											)}
										>
											<div
												{...stylex.attrs(
													styles.repoCheck,
													isSelected() && styles.repoCheckSelected,
												)}
											>
												{isSelected() && <IconCheck size={iconSize.sm} />}
											</div>
											<div {...stylex.attrs(styles.rowText)}>
												<p {...stylex.attrs(styles.repoName)}>
													{repo().full_name}
												</p>
												{repo().description && (
													<p {...stylex.attrs(styles.repoDescription)}>
														{repo().description}
													</p>
												)}
											</div>
											<div {...stylex.attrs(styles.repoMeta)}>
												{repo().language && (
													<span {...stylex.attrs(styles.repoLanguage)}>
														{repo().language}
													</span>
												)}
												{repo().private && (
													<span {...stylex.attrs(styles.privatePill)}>
														private
													</span>
												)}
											</div>
										</button>
									);
								}}
							</For>
						) : _props.localFolders.length === 0 ? (
							<div {...stylex.attrs(styles.projectEmpty)}>
								Choose a local folder or select GitHub repos
								<br />
								to get started.
							</div>
						) : null}
					</div>
				</div>

				<div {...stylex.attrs(styles.primaryActions)}>
					<Button
						type="button"
						onClick={_props.onBack}
						variant="ghost"
						size="lg"
					>
						<IconArrowLeft size={iconSize.xl} />
						Back
					</Button>
					<Button
						type="button"
						onClick={_props.onComplete}
						variant="secondary"
						size="lg"
					>
						{totalProjects() > 0 ? "Let's build" : "Skip & enter"}
						<IconChevronRight size={iconSize.xl} />
					</Button>
				</div>
			</div>
		</section>
	);
}
