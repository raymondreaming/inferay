import { useBackgroundQuery } from "@shared/hooks/useQueryResource.tsx";
import { queryClient } from "@shared/lib/dom.tsx";
import * as stylex from "@stylexjs/stylex";
import { readPluginLibrary } from "../../services/projectsApi.ts";
import { styles } from "./styles.ts";

/** Inventory describes the library itself; schedules appear separately. */
export function PluginContentsSummary(props: { id: string }) {
	const library = useBackgroundQuery(
		() => ({
			queryKey: ["plugin-library", props.id],
			queryFn: () => readPluginLibrary(props.id),
		}),
		() => queryClient,
	);
	const summary = () => {
		const files = library.data?.files;
		if (!files) return "";
		const skills = files.filter((file) =>
			/^skills\/.*\.md$/.test(file.path),
		).length;
		const tools = files.filter((file) =>
			/^tools\/[^/]+\/tool\.json$/.test(file.path),
		).length;
		const supporting = files.filter(
			(file) =>
				file.path !== "plugin.json" &&
				!/^skills\/.*\.md$/.test(file.path) &&
				!/^tools\/[^/]+\/tool\.json$/.test(file.path) &&
				!/^automations\/[^/]+\.json$/.test(file.path),
		).length;
		return [
			skills ? `${skills} ${skills === 1 ? "skill" : "skills"}` : "",
			tools ? `${tools} ${tools === 1 ? "tool" : "tools"}` : "",
			supporting
				? `${supporting} supporting ${supporting === 1 ? "file" : "files"}`
				: "",
		]
			.filter(Boolean)
			.join(" · ");
	};
	return (
		<>
			{summary() && <span {...stylex.attrs(styles.muted)}>{summary()}</span>}
			{library.data && !summary() && (
				<span {...stylex.attrs(styles.muted)}>
					Contains automation definitions only
				</span>
			)}
			{library.error && (
				<span role="status" {...stylex.attrs(styles.muted)}>
					Contents unavailable
				</span>
			)}
		</>
	);
}
