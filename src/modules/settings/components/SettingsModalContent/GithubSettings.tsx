import type { GithubRepo } from "@contracts";
import { iconSize } from "@design-system/styles.stylex.ts";
import {
	invalidateForgeAccountsCache,
	invalidateGithubReposCache,
	useForgeAccounts,
	useGithubRepos,
} from "@repository/hooks/useForgeAccounts.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { IconRefreshCw } from "@shared/ui/Icons/index.tsx";
import {
	SettingsEmpty,
	SettingsRow,
	SettingsSection,
} from "@shared/ui/SettingsSurface/index.tsx";
import { TextInput } from "@shared/ui/TextInput/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For } from "solid-js";
import {
	cloneGithubRepo,
	connectGithub,
	pickCloneDirectory,
} from "../../services/settingsApi.ts";
import {
	SettingsGithubAccount,
	SettingsGithubEmptyState,
	SettingsRepoRow,
} from "../SettingsGithub/index.tsx";
import {
	SettingsErrorBanner,
	SettingsSuccessBanner,
} from "../SettingsStatus/index.tsx";
import { styles } from "./styles.ts";

/** GitHub account discovery, repository browsing, and cloning settings. */
export function GithubSettings() {
	const accounts = useForgeAccounts(() => true);
	const repos = useGithubRepos(() => accounts.data.length > 0);
	const [error, setError] = createSignal<string | null>(null);
	const [connecting, setConnecting] = createSignal(false);
	const [repoQuery, setRepoQuery] = createSignal("");
	const [cloneDirectory, setCloneDirectory] = createSignal("~/Desktop");
	const [cloneStatus, setCloneStatus] = createSignal<string | null>(null);
	const [cloningRepo, setCloningRepo] = createSignal<string | null>(null);
	const filteredRepos = createMemo(() => {
		const query = repoQuery().trim().toLowerCase();
		if (!query) return repos.data;
		return repos.data.filter(
			(repo) =>
				repo.full_name.toLowerCase().includes(query) ||
				repo.description?.toLowerCase().includes(query),
		);
	});
	const refreshRepos = async () => {
		setError(null);
		invalidateGithubReposCache();
		await repos.refresh();
	};
	const refreshAccounts = async () => {
		invalidateForgeAccountsCache();
		await accounts.refresh();
	};
	const startGithubConnect = async () => {
		setConnecting(true);
		try {
			await connectGithub();
		} finally {
			setConnecting(false);
		}
	};
	const chooseCloneDirectory = async () => {
		const folder = await pickCloneDirectory();
		if (folder) setCloneDirectory(folder);
	};
	const cloneRepo = async (repo: GithubRepo) => {
		setCloningRepo(repo.full_name);
		setCloneStatus(null);
		setError(null);
		try {
			setCloneStatus(await cloneGithubRepo(repo, cloneDirectory()));
			invalidateGithubReposCache();
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "Unable to clone repository",
			);
		} finally {
			setCloningRepo(null);
		}
	};
	const resourceError = createMemo(() => error() ?? repos.error);
	return (
		<>
			<SettingsSection
				id="github-account"
				title={accounts.data.length > 1 ? "Accounts" : "Account"}
				description="Your GitHub identity, detected from the GitHub CLI."
				action={
					<Button
						type="button"
						onClick={() => void refreshAccounts()}
						variant="ghost"
						size="sm"
						class={stylex.attrs(styles.noShrink).class}
					>
						<IconRefreshCw size={iconSize.md} />
						<span>Refresh</span>
					</Button>
				}
			>
				{accounts.error ? (
					<div {...stylex.attrs(styles.banner)}>
						<SettingsErrorBanner message={accounts.error} />
					</div>
				) : null}
				{accounts.loading ? (
					<SettingsEmpty>Checking GitHub CLI account…</SettingsEmpty>
				) : accounts.data.length > 0 ? (
					<For
						each={accounts.data}
						keyed={(row) => JSON.stringify([row.host, row.login])}
					>
						{(account) => <SettingsGithubAccount account={account()} />}
					</For>
				) : (
					<SettingsGithubEmptyState
						onConnect={startGithubConnect}
						connecting={connecting()}
					/>
				)}
			</SettingsSection>
			<SettingsSection
				id="github"
				title="Repositories"
				description="Find repositories from your connected account and clone them locally."
				action={
					accounts.data.length > 0 ? (
						<Button
							type="button"
							onClick={() => void refreshRepos()}
							variant="ghost"
							size="sm"
							class={stylex.attrs(styles.noShrink).class}
						>
							<IconRefreshCw size={iconSize.md} />
							<span>Refresh</span>
						</Button>
					) : undefined
				}
			>
				{resourceError() ? (
					<div {...stylex.attrs(styles.banner)}>
						<SettingsErrorBanner message={resourceError()!} />
					</div>
				) : null}
				{cloneStatus() ? (
					<div {...stylex.attrs(styles.banner)}>
						<SettingsSuccessBanner message={cloneStatus()!} />
					</div>
				) : null}
				{accounts.data.length > 0 ? (
					<>
						<SettingsRow label="Find a repository">
							<TextInput
								type="text"
								size="sm"
								value={repoQuery()}
								onChange={(event) => setRepoQuery(event.currentTarget.value)}
								placeholder="Search repositories"
								class={stylex.attrs(styles.search).class}
							/>
						</SettingsRow>
						<SettingsRow
							label="Clone into"
							description="Where new clones land on disk."
						>
							<TextInput
								type="text"
								size="sm"
								value={cloneDirectory()}
								onChange={(event) =>
									setCloneDirectory(event.currentTarget.value)
								}
								class={stylex.attrs(styles.cloneDirectory).class}
							/>
							<Button
								type="button"
								onClick={() => void chooseCloneDirectory()}
								variant="ghost"
								size="sm"
								class={stylex.attrs(styles.noShrink).class}
							>
								Browse
							</Button>
						</SettingsRow>
						<div {...stylex.attrs(styles.repoList)}>
							{repos.loading ? (
								<SettingsEmpty>Loading repositories…</SettingsEmpty>
							) : filteredRepos().length === 0 ? (
								<SettingsEmpty>No repositories found.</SettingsEmpty>
							) : (
								<For each={filteredRepos()} keyed={(row) => row.full_name}>
									{(repo) => (
										<SettingsRepoRow
											repo={repo()}
											cloning={cloningRepo() === repo().full_name}
											onClone={() => void cloneRepo(repo())}
										/>
									)}
								</For>
							)}
						</div>
					</>
				) : (
					<SettingsEmpty>
						Connect a GitHub account to browse repositories.
					</SettingsEmpty>
				)}
			</SettingsSection>
		</>
	);
}
