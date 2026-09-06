import * as stylex from "@octanejs/stylex";
import { getStepPhase, type Step } from "../../../../app/model/appearance.ts";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import {
	IconAgent,
	IconArrowLeft,
	IconChevronRight,
	IconGitBranch,
	IconRefreshCw,
	IconUser,
} from "../../../../shared/ui/Icons/index.tsx";
import type { ForgeAccount } from "../../../repository/model/types.ts";
import { styles } from "./styles.ts";
export function GithubStep({
	step,
	accounts,
	loading,
	connecting,
	onConnect,
	onRefresh,
	onBack,
	onNext,
}: {
	step: Step;
	accounts: ForgeAccount[];
	loading: boolean;
	connecting: boolean;
	onConnect: () => void;
	onRefresh: () => void;
	onBack: () => void;
	onNext: () => void;
}) {
	const phase = getStepPhase(step, "github");
	return (
		<section
			aria-hidden={step !== "github"}
			{...stylex.props(
				styles.stepSurface,
				styles.stepSurfaceStandard,
				phase === "active" && styles.stepActive,
				phase === "before" && styles.forwardBefore,
				phase === "after" && styles.forwardAfter,
			)}
		>
			<div {...stylex.props(styles.stepPanel)}>
				<div {...stylex.props(styles.centerText)}>
					<h2 {...stylex.props(styles.stepTitle)}>Connect GitHub</h2>
					<p {...stylex.props(styles.stepDescription)}>
						Inferay detects accounts from the GitHub CLI. If you already have{" "}
						<span {...stylex.props(styles.inlineCodeText)}>gh</span>{" "}
						authenticated, your account appears automatically.
					</p>
				</div>

				<div {...stylex.props(styles.stepContent)}>
					{loading ? (
						<div {...stylex.props(styles.loadingState)}>
							<IconRefreshCw
								size={iconSize._2lg}
								{...stylex.props(styles.spinIcon)}
							/>
							Checking gh auth status…
						</div>
					) : accounts.length > 0 ? (
						<div {...stylex.props(styles.accountList)}>
							{accounts.map((account) => (
								<div
									key={`${account.host}:${account.login}`}
									{...stylex.props(styles.accountRow)}
								>
									<div {...stylex.props(styles.avatarFrame)}>
										{account.avatarUrl ? (
											<img
												src={account.avatarUrl}
												alt={account.login}
												{...stylex.props(styles.avatar)}
											/>
										) : (
											<IconUser
												size={iconSize._2xl}
												{...stylex.props(styles.mutedIcon)}
											/>
										)}
									</div>
									<div {...stylex.props(styles.rowText)}>
										<p {...stylex.props(styles.accountName)}>{account.login}</p>
										<p {...stylex.props(styles.accountMeta)}>
											@{account.login} · {account.host}
										</p>
									</div>
								</div>
							))}
						</div>
					) : (
						<div {...stylex.props(styles.noticeCard)}>
							<div {...stylex.props(styles.noticeIconBox)}>
								<IconGitBranch size={iconSize._3xl} />
							</div>
							<p {...stylex.props(styles.noticeTitle)}>
								No GitHub accounts detected
							</p>
							<p {...stylex.props(styles.noticeText)}>
								Run the GitHub CLI login to connect your account.
							</p>
							<div {...stylex.props(styles.noticeActions)}>
								<Button
									type="button"
									onClick={onConnect}
									disabled={connecting}
									variant="secondary"
									size="lg"
								>
									<IconAgent size={iconSize.lg} />
									{connecting ? "Opening agent..." : "Run gh auth login"}
								</Button>
								<Button
									type="button"
									onClick={onRefresh}
									disabled={loading}
									variant="ghost"
									size="lg"
								>
									<IconRefreshCw size={iconSize._2md} />
									Refresh
								</Button>
							</div>
						</div>
					)}
				</div>

				<div {...stylex.props(styles.primaryActions)}>
					<Button type="button" onClick={onBack} variant="ghost" size="lg">
						<IconArrowLeft size={iconSize.xl} />
						Back
					</Button>
					<Button type="button" onClick={onNext} variant="secondary" size="lg">
						{accounts.length > 0 ? "Continue" : "Skip"}
						<IconChevronRight size={iconSize.xl} />
					</Button>
				</div>
			</div>
		</section>
	);
}
