import * as stylex from "@octanejs/stylex";
import { getStepPhase, type Step } from "../../../../app/model/appearance.ts";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
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
import type { GithubRepo } from "../../../repository/model/types.ts";
import { styles } from "./styles.ts";
export function ProjectsStep({
	step,
	repos,
	reposLoading,
	hasGithub,
	selected,
	onToggle,
	onRefreshRepos,
	localFolders,
	isAddingFolder,
	onPickFolder,
	onRemoveFolder,
	onBack,
	onComplete,
}: {
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
	const totalProjects = selected.size + localFolders.length;
	const phase = getStepPhase(step, "projects");
	return (
		<section
			aria-hidden={step !== "projects"}
			{...stylex.props(
				styles.stepSurface,
				styles.stepSurfaceSlow,
				phase === "active" && styles.stepActive,
				phase === "before" && styles.forwardBefore,
				phase === "after" && styles.projectsAfter,
			)}
		>
			<div {...stylex.props(styles.projectPanel)}>
				<div {...stylex.props(styles.centerText)}>
					<h2 {...stylex.props(styles.stepTitle)}>Bring in your projects</h2>
					<p {...stylex.props(styles.stepDescription)}>
						Start with a local folder or select repositories from GitHub. You
						can add more anytime.
					</p>
				</div>

				<div {...stylex.props(styles.actionCards)}>
					<button
						type="button"
						onClick={onPickFolder}
						disabled={isAddingFolder}
						{...stylex.props(styles.projectActionCard)}
					>
						<div {...stylex.props(styles.projectActionIcon)}>
							<IconFolderOpen size={iconSize._3xl} />
						</div>
						<div {...stylex.props(styles.projectActionTitle)}>
							Choose local project
						</div>
						<p {...stylex.props(styles.projectActionText)}>
							Add a folder already on this machine.
						</p>
					</button>
					<button
						type="button"
						onClick={hasGithub ? onRefreshRepos : undefined}
						disabled={!hasGithub || reposLoading}
						{...stylex.props(styles.projectActionCard)}
					>
						<div {...stylex.props(styles.projectActionIcon)}>
							<IconGlobe size={iconSize._3xl} />
						</div>
						<div {...stylex.props(styles.projectActionTitle)}>
							Import from GitHub
						</div>
						<p {...stylex.props(styles.projectActionText)}>
							{hasGithub
								? "Select from your repositories below."
								: "Connect GitHub first to browse repos."}
						</p>
					</button>
				</div>

				{/* Added projects list */}
				<div {...stylex.props(styles.projectListSection)}>
					<div {...stylex.props(styles.listMeta)}>
						<span>
							{hasGithub && repos.length > 0
								? "Your repositories"
								: localFolders.length > 0
									? "Added projects"
									: "Projects"}
						</span>
						{totalProjects > 0 && <span>{totalProjects}</span>}
					</div>
					<div {...stylex.props(styles.projectList)}>
						{localFolders.map((folder) => (
							<div key={folder} {...stylex.props(styles.localFolderRow)}>
								<IconFolder
									size={iconSize.lg}
									{...stylex.props(styles.mutedIcon, styles.shrink)}
								/>
								<div {...stylex.props(styles.rowText)}>
									<p {...stylex.props(styles.repoName)}>{folder}</p>
								</div>
								<IconButton
									type="button"
									onClick={() => onRemoveFolder(folder)}
									variant="danger"
									size="xs"
								>
									<IconX size={iconSize.lg} />
								</IconButton>
							</div>
						))}

						{hasGithub && reposLoading ? (
							<div {...stylex.props(styles.loadingState)}>
								<IconRefreshCw
									size={iconSize._2md}
									{...stylex.props(styles.spinIcon)}
								/>
								Loading repositories…
							</div>
						) : hasGithub && repos.length > 0 ? (
							repos.map((repo) => {
								const isSelected = selected.has(repo.full_name);
								return (
									<button
										type="button"
										key={repo.full_name}
										onClick={() => onToggle(repo.full_name)}
										{...stylex.props(
											styles.repoRow,
											isSelected && styles.repoRowSelected,
										)}
									>
										<div
											{...stylex.props(
												styles.repoCheck,
												isSelected && styles.repoCheckSelected,
											)}
										>
											{isSelected && <IconCheck size={iconSize.sm} />}
										</div>
										<div {...stylex.props(styles.rowText)}>
											<p {...stylex.props(styles.repoName)}>{repo.full_name}</p>
											{repo.description && (
												<p {...stylex.props(styles.repoDescription)}>
													{repo.description}
												</p>
											)}
										</div>
										<div {...stylex.props(styles.repoMeta)}>
											{repo.language && (
												<span {...stylex.props(styles.repoLanguage)}>
													{repo.language}
												</span>
											)}
											{repo.private && (
												<span {...stylex.props(styles.privatePill)}>
													private
												</span>
											)}
										</div>
									</button>
								);
							})
						) : localFolders.length === 0 ? (
							<div {...stylex.props(styles.projectEmpty)}>
								Choose a local folder or select GitHub repos
								<br />
								to get started.
							</div>
						) : null}
					</div>
				</div>

				<div {...stylex.props(styles.primaryActions)}>
					<Button type="button" onClick={onBack} variant="ghost" size="lg">
						<IconArrowLeft size={iconSize.xl} />
						Back
					</Button>
					<Button
						type="button"
						onClick={onComplete}
						variant="secondary"
						size="lg"
					>
						{totalProjects > 0 ? "Let's build" : "Skip & enter"}
						<IconChevronRight size={iconSize.xl} />
					</Button>
				</div>
			</div>
		</section>
	);
}
