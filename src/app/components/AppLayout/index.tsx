import { OnboardingLayer } from "@onboarding/components/OnboardingLayer/index.tsx";
import { SettingsPageHost } from "@settings/components/SettingsPage/index.tsx";
import {
	useAppAppearance,
	usesNativeGlass,
} from "@settings/hooks/useAppAppearance.tsx";
import { wsClient } from "@shared/lib/native.tsx";
import * as stylex from "@stylexjs/stylex";
import { ProjectsPanel } from "@workspace/components/ProjectsPanel/index.tsx";
import { RepositoryPanel } from "@workspace/components/RepositoryPanel/index.tsx";
import { RepositoryWorkspaceBar } from "@workspace/components/RepositoryWorkspaceBar/index.tsx";
import { WorkspaceSidebar } from "@workspace/components/WorkspaceSidebar/index.tsx";
import {
	initializeProjects,
	projects,
	refreshProjects,
} from "@workspace/hooks/useProjects.tsx";
import { loadCanonicalAgentState } from "@workspace/hooks/useWorkspaceState.tsx";
import type { Element } from "solid-js";
import { Loading, onSettled, Show } from "solid-js";
import { AppHeader } from "../AppHeader/index.tsx";
import { shellThemeProps, styles } from "./styles.ts";
export function AppLayout(props: { children: Element }) {
	const _source = useAppAppearance();
	onSettled(() => {
		wsClient.connect();
		void initializeProjects();
		const timer = setInterval(() => {
			if (!document.hidden && !projects.busy()) {
				void refreshProjects();
				void loadCanonicalAgentState();
			}
		}, 3000);
		return () => clearInterval(timer);
	});
	return (
		<div {...shellThemeProps} data-background-mode={_source.background.mode}>
			<div
				aria-hidden="true"
				{...stylex.attrs(styles.backgroundLayer)}
				style={{
					"background-image": _source.backgroundUrl
						? `url("${_source.backgroundUrl}")`
						: "none",
					filter: `blur(${_source.background.blur}px)`,
				}}
			/>
			{_source.background.mode === "glass" && !usesNativeGlass ? (
				<div
					aria-hidden="true"
					data-glass-backdrop="true"
					{...stylex.attrs(styles.glassBackdrop)}
					style={{
						"-webkit-backdrop-filter": `blur(${_source.background.glassBlur}px) saturate(115%)`,
						"backdrop-filter": `blur(${_source.background.glassBlur}px) saturate(115%)`,
						"background-color": `color-mix(in srgb, #000000 ${_source.background.glassOpacity}%, transparent)`,
					}}
				/>
			) : null}
			<div
				aria-hidden="true"
				{...stylex.attrs(styles.backgroundShade)}
				style={{
					background:
						_source.background.mode === "scene"
							? `radial-gradient(ellipse at center, rgba(0, 0, 0, ${Math.min(0.78, _source.background.dim / 100 + 0.08)}) 0%, rgba(0, 0, 0, ${Math.min(0.88, _source.background.dim / 100 + 0.18)}) 100%)`
							: "none",
				}}
			/>
			<AppHeader />
			<SettingsPageHost>
				<RepositoryWorkspaceBar />
				{projects.view() === "chat" && projects.selectedId() ? (
					<OnboardingLayer />
				) : null}
				<div {...stylex.attrs(styles.appBody)}>
					<WorkspaceSidebar />
					<div {...stylex.attrs(styles.mainColumn)}>
						<main {...stylex.attrs(styles.mainContent)}>
							<Loading fallback={null}>
								{projects.view() === "chat" && projects.selectedId() ? (
									props.children
								) : (
									<Show when={projects.selectedId() || "all"} keyed>
										{(_projectId) => <ProjectsPanel />}
									</Show>
								)}
							</Loading>
						</main>
						<Show
							when={projects.repositoryOpen() && projects.selectedId()}
							keyed
						>
							{(_projectId) => <RepositoryPanel />}
						</Show>
					</div>
				</div>
			</SettingsPageHost>
		</div>
	);
}
