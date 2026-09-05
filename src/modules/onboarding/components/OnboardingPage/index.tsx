import * as stylex from "@octanejs/stylex";
import { useNavigate } from "@octanejs/tanstack-router";
import { useCallback, useEffect, useState } from "octane";
import {
	fetchJsonOr,
	sendJsonWithBusy,
} from "../../../../adapters/backend/http.ts";
import {
	AGENT_MAIN_VIEW_STORAGE_KEY,
	ONBOARDING_DONE_STORAGE_KEY,
} from "../../../../adapters/storage/keys.ts";
import {
	readStoredBoolean,
	writeStoredValue,
} from "../../../../adapters/storage/stored-values.ts";
import {
	applyAppTheme,
	DEFAULT_APP_BACKGROUND_SETTINGS,
	loadAppThemeId,
	saveAppBackgroundSettings,
	saveAppThemeId,
} from "../../../../app/model/appearance.ts";
import { useQueryResource } from "../../../../shared/hooks/useQueryResource.tsx";
import { lacksValue } from "../../../../shared/lib/data.ts";
import {
	fetchForgeAccounts,
	fetchGithubRepos,
	invalidateForgeAccountsCache,
} from "../../../repository/adapters/forge-client.ts";
import {
	loadCanonicalAgentState,
	mutateAgentWorkspaceState,
} from "../../../workspace/model/workspace-model.ts";
import { GithubStep } from "./GithubStep.tsx";
import { IntroStep } from "./IntroStep.tsx";
import { ProjectsStep } from "./ProjectsStep.tsx";
import type { Step } from "./shared.ts";
import { styles } from "./styles.ts";

export const ONBOARDING_DONE_KEY = ONBOARDING_DONE_STORAGE_KEY;

export function OnboardingPage() {
	const navigate = useNavigate();
	const [isFirstRun] = useState(() => !readStoredBoolean(ONBOARDING_DONE_KEY));
	const [step, setStep] = useState<Step>("intro");
	const [connecting, setConnecting] = useState(false);
	const [localFolders, setLocalFolders] = useState<string[]>([]);
	const [isAddingFolder, setIsAddingFolder] = useState(false);
	const [selectedRepos, setSelectedRepos] = useState<Set<string>>(
		() => new Set(),
	);

	const {
		data: accounts,
		setData: setAccounts,
		loading: accountsLoading,
	} = useQueryResource(() => fetchForgeAccounts(), [], {
		queryKey: ["forge", "accounts"],
	});
	const fetchRepos = useCallback(
		async () => (accounts.length > 0 ? fetchGithubRepos() : []),
		[accounts.length],
	);
	const {
		data: repos,
		loading: reposLoading,
		refresh: refreshRepos,
	} = useQueryResource(fetchRepos, [], {
		queryKey: ["forge", "repos"],
	});
	const refreshAccounts = async () => {
		invalidateForgeAccountsCache();
		setAccounts(await fetchForgeAccounts(true));
	};

	useEffect(() => {
		applyAppTheme("default");
		return () => {
			if (!isFirstRun) applyAppTheme(loadAppThemeId());
		};
	}, [isFirstRun]);

	const connectGithub = async () => {
		await sendJsonWithBusy(setConnecting, "/api/forge/connect", {
			provider: "github",
		});
		invalidateForgeAccountsCache();
		setAccounts(await fetchForgeAccounts(true));
	};

	useEffect(() => {
		if (step !== "github" || accounts.length > 0 || connecting) return;
		const id = window.setInterval(() => {
			invalidateForgeAccountsCache();
			fetchForgeAccounts(true)
				.then(setAccounts)
				.catch(() => undefined);
		}, 3000);
		return () => window.clearInterval(id);
	}, [accounts.length, connecting, setAccounts, step]);

	const pickFolder = async () => {
		if (isAddingFolder) return;
		setIsAddingFolder(true);
		try {
			const data = await fetchJsonOr<{ folder: string | null }>(
				"/api/config/pick-folder",
				{ folder: null },
				{ method: "POST" },
			);
			if (data.folder && !localFolders.includes(data.folder)) {
				setLocalFolders((prev) => [...prev, data.folder as string]);
			}
		} catch {
			// ignore
		} finally {
			setIsAddingFolder(false);
		}
	};

	const removeFolder = (folder: string) => {
		setLocalFolders((prev) => prev.filter(lacksValue.bind(null, folder)));
	};

	const toggleRepo = (fullName: string) => {
		setSelectedRepos((prev) => {
			const next = new Set(prev);
			if (next.has(fullName)) next.delete(fullName);
			else next.add(fullName);
			return next;
		});
	};

	const finish = useCallback(async () => {
		if (isFirstRun) {
			saveAppThemeId("default");
			saveAppBackgroundSettings(DEFAULT_APP_BACKGROUND_SETTINGS);
		}
		writeStoredValue(ONBOARDING_DONE_KEY, "true");
		// Default to grid layout
		writeStoredValue("agent-layout-mode", "grid");
		writeStoredValue(AGENT_MAIN_VIEW_STORAGE_KEY, "chat");
		// New users land directly in the multi-agent chat grid.
		const canonicalState = await loadCanonicalAgentState();
		if (!canonicalState || isFirstRun)
			await mutateAgentWorkspaceState(
				{ type: "setTheme", themeId: "default" },
				"onboarding-default",
				{ createIfMissing: true },
			);
		navigate({ to: "/agent", replace: true });
	}, [isFirstRun, navigate]);

	const completeOnboarding = useCallback(() => {
		setStep("complete");
		window.setTimeout(finish, 600);
	}, [finish, setStep]);

	return (
		<main {...stylex.props(styles.root)}>
			{/* Grid background — like Helmor */}
			<div
				aria-hidden
				{...stylex.props(
					styles.gridBackdrop,
					step === "complete"
						? styles.gridBackdropHidden
						: styles.gridBackdropVisible,
				)}
			/>
			{/* Bottom fade */}
			<div aria-hidden {...stylex.props(styles.bottomFade)} />

			{/* All steps rendered simultaneously — CSS transitions only */}
			<IntroStep
				step={step}
				onNext={setStep.bind(null, "github")}
				onSkip={finish}
			/>
			<GithubStep
				step={step}
				accounts={accounts}
				loading={accountsLoading}
				connecting={connecting}
				onConnect={connectGithub}
				onRefresh={refreshAccounts}
				onBack={setStep.bind(null, "intro")}
				onNext={setStep.bind(null, "projects")}
			/>
			<ProjectsStep
				step={step}
				repos={repos}
				reposLoading={reposLoading}
				hasGithub={accounts.length > 0}
				selected={selectedRepos}
				onToggle={toggleRepo}
				onRefreshRepos={refreshRepos}
				localFolders={localFolders}
				isAddingFolder={isAddingFolder}
				onPickFolder={pickFolder}
				onRemoveFolder={removeFolder}
				onBack={setStep.bind(null, "github")}
				onComplete={completeOnboarding}
			/>
		</main>
	);
}
