import * as stylex from "@stylexjs/stylex";
import type { GithubRepo } from "../../../../../build/presentation/contracts/GithubRepo.ts";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import {
	IconExternalLink,
	IconPlus,
} from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";
export function SettingsRepoRow(_props: {
	repo: GithubRepo;
	cloning: boolean;
	onClone: () => void;
}) {
	return (
		<div {...stylex.attrs(styles.repoRow)}>
			<div {...stylex.attrs(styles.rowText)}>
				<div {...stylex.attrs(styles.inlineRow)}>
					<p {...stylex.attrs(styles.repoName)}>{_props.repo.full_name}</p>
					{_props.repo.private ? (
						<span {...stylex.attrs(styles.privatePill)}>Private</span>
					) : null}
				</div>
				<p {...stylex.attrs(styles.repoDescription)}>
					{_props.repo.description || _props.repo.language || "No description"}
				</p>
			</div>
			<a
				href={_props.repo.html_url}
				target="_blank"
				rel="noreferrer"
				{...stylex.attrs(styles.externalLink)}
				title="Open on GitHub"
			>
				<IconExternalLink size={iconSize.md} />
			</a>
			<Button
				liquid={false}
				type="button"
				onClick={_props.onClone}
				disabled={_props.cloning}
				variant="secondary"
				size="sm"
			>
				<IconPlus size={iconSize.md} />
				<span>{_props.cloning ? "Cloning" : "Clone"}</span>
			</Button>
		</div>
	);
}
