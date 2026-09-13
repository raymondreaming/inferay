import type { Prompt, SkillFormState } from "@contracts";
import * as stylex from "@stylexjs/stylex";
import { createMemo, For } from "solid-js";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { setInputValue } from "../../../../shared/lib/dom.tsx";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import { IconPlus, IconSearch } from "../../../../shared/ui/Icons/index.tsx";
import { SkillLibraryItem } from "./SkillLibraryItem.tsx";
import { styles } from "./styles.ts";

export function SkillLibrary(_props: {
	startCreate: () => void;
	form: Pick<SkillFormState, "isSaving" | "isCreating">;
	search: string;
	setSearch: (value: string) => void;
	filtered: Prompt[];
	loading: boolean;
	filtering: boolean;
	selectedId: string | null;
	selectSkill: (skill: Prompt) => void;
}) {
	return (
		<aside aria-label="Skills library" {...stylex.attrs(styles.listPane)}>
			<div {...stylex.attrs(styles.libraryControls)}>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					onClick={_props.startCreate}
					disabled={_props.form.isSaving}
					class={stylex.attrs(styles.newButton).class}
				>
					<IconPlus size={iconSize.md} />
					<span>New skill</span>
				</Button>
				<div {...stylex.attrs(styles.searchWrap)}>
					<IconSearch size={iconSize.md} {...stylex.attrs(styles.searchIcon)} />
					<input
						type="search"
						value={_props.search}
						onInput={setInputValue.bind(null, _props.setSearch)}
						placeholder="Find a skill…"
						aria-label="Search skills"
						{...stylex.attrs(styles.searchInput)}
					/>
				</div>
			</div>
			<div {...stylex.attrs(styles.libraryHeading)}>
				<span {...stylex.attrs(styles.libraryHeadingLabel)}>Library</span>
				<span {...stylex.attrs(styles.count)}>{_props.filtered.length}</span>
			</div>
			<nav aria-label="Saved skills" {...stylex.attrs(styles.skillList)}>
				{_props.filtered.length === 0 ? (
					<div {...stylex.attrs(styles.emptyList)}>
						<span>
							{_props.loading || _props.filtering
								? "Loading skills…"
								: "No skills found"}
						</span>
						<span>
							{_props.search
								? "Try another name or command."
								: "Create a skill to get started."}
						</span>
					</div>
				) : (
					<For each={_props.filtered} keyed={(row) => row._id}>
						{(skill) => {
							const active = createMemo(
								() =>
									!_props.form.isCreating && _props.selectedId === skill()._id,
							);
							return (
								<SkillLibraryItem
									skill={skill()}
									active={active()}
									disabled={_props.form.isSaving}
									selectSkill={_props.selectSkill}
								/>
							);
						}}
					</For>
				)}
			</nav>
		</aside>
	);
}
