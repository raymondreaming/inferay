import * as stylex from "@stylexjs/stylex";
import { createMemo, For } from "solid-js";
import type { ForgeAccount } from "../../../../../build/presentation/contracts/ForgeAccount.ts";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { ariaValue } from "../../../../shared/lib/dom.tsx";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import {
	IconAgent,
	IconArrowLeft,
	IconChevronRight,
	IconGitBranch,
	IconRefreshCw,
	IconUser,
} from "../../../../shared/ui/Icons/index.tsx";
import { getStepPhase, type Step } from "../../hooks/useOnboardingStep.tsx";
import { styles } from "./styles.ts";
export function GithubStep(_props: {
	step: Step;
	accounts: ForgeAccount[];
	loading: boolean;
	connecting: boolean;
	onConnect: () => void;
	onRefresh: () => void;
	onBack: () => void;
	onNext: () => void;
}) {
	const phase = createMemo(() => getStepPhase(_props.step, "github"));
	return (
		<section
			aria-hidden={ariaValue(_props.step !== "github")}
			{...stylex.attrs(
				styles.stepSurface,
				styles.stepSurfaceStandard,
				phase() === "active" && styles.stepActive,
				phase() === "before" && styles.forwardBefore,
				phase() === "after" && styles.forwardAfter,
			)}
		>
			<div {...stylex.attrs(styles.stepPanel)}>
				<div {...stylex.attrs(styles.centerText)}>
					<h2 {...stylex.attrs(styles.stepTitle)}>Connect GitHub</h2>
					<p {...stylex.attrs(styles.stepDescription)}>
						Inferay detects accounts from the GitHub CLI. If you already have{" "}
						<span {...stylex.attrs(styles.inlineCodeText)}>gh</span>{" "}
						authenticated, your account appears automatically.
					</p>
				</div>

				<div {...stylex.attrs(styles.stepContent)}>
					{_props.loading ? (
						<div {...stylex.attrs(styles.loadingState)}>
							<IconRefreshCw
								size={iconSize._2lg}
								{...stylex.attrs(styles.spinIcon)}
							/>
							Checking gh auth status…
						</div>
					) : _props.accounts.length > 0 ? (
						<div {...stylex.attrs(styles.accountList)}>
							{
								<For
									each={_props.accounts}
									keyed={(row) => JSON.stringify([row.host, row.login])}
								>
									{(account) => (
										<div {...stylex.attrs(styles.accountRow)}>
											<div {...stylex.attrs(styles.avatarFrame)}>
												{account().avatarUrl ? (
													<img
														src={account().avatarUrl ?? undefined}
														alt={account().login}
														{...stylex.attrs(styles.avatar)}
													/>
												) : (
													<IconUser
														size={iconSize._2xl}
														{...stylex.attrs(styles.mutedIcon)}
													/>
												)}
											</div>
											<div {...stylex.attrs(styles.rowText)}>
												<p {...stylex.attrs(styles.accountName)}>
													{account().login}
												</p>
												<p {...stylex.attrs(styles.accountMeta)}>
													@{account().login} · {account().host}
												</p>
											</div>
										</div>
									)}
								</For>
							}
						</div>
					) : (
						<div {...stylex.attrs(styles.noticeCard)}>
							<div {...stylex.attrs(styles.noticeIconBox)}>
								<IconGitBranch size={iconSize._3xl} />
							</div>
							<p {...stylex.attrs(styles.noticeTitle)}>
								No GitHub accounts detected
							</p>
							<p {...stylex.attrs(styles.noticeText)}>
								Run the GitHub CLI login to connect your account.
							</p>
							<div {...stylex.attrs(styles.noticeActions)}>
								<Button
									type="button"
									onClick={_props.onConnect}
									disabled={_props.connecting}
									variant="secondary"
									size="lg"
								>
									<IconAgent size={iconSize.lg} />
									{_props.connecting ? "Opening agent..." : "Run gh auth login"}
								</Button>
								<Button
									type="button"
									onClick={_props.onRefresh}
									disabled={_props.loading}
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
						onClick={_props.onNext}
						variant="secondary"
						size="lg"
					>
						{_props.accounts.length > 0 ? "Continue" : "Skip"}
						<IconChevronRight size={iconSize.xl} />
					</Button>
				</div>
			</div>
		</section>
	);
}
