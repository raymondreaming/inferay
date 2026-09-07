import * as stylex from "@stylexjs/stylex";
import { createMemo, For } from "solid-js";
import type { Prompt } from "../../../../../build/presentation/contracts/Prompt.ts";
import type { SkillFormState } from "../../../../../build/presentation/contracts/SkillFormState.ts";
import {
	iconSize,
	surfaceStyles,
} from "../../../../design-system/styles.stylex.ts";
import { setInputValue } from "../../../../shared/lib/dom.tsx";
import { IconPlus, IconSearch } from "../../../../shared/ui/Icons/index.tsx";
import { SkillLibraryItem } from "./SkillLibraryItem.tsx";
import { styles } from "./styles.ts";
export function SkillLibrary(_props: {
	startCreate: () => void;
	form: Pick<SkillFormState, "isSaving" | "isCreating">;
	search: string;
	setSearch: (value: string) => void;
	filter: string;
	setFilter: (value: string) => void;
	filtered: Prompt[];
	loading: boolean;
	filtering: boolean;
	selectedId: string | null;
	selectSkill: (skill: Prompt) => void;
}) {
	return (
		<aside aria-label="Skills library" {...stylex.attrs(styles.listPane)}>
			<div {...stylex.attrs(styles.libraryControls)}>
				<button
					type="button"
					onClick={_props.startCreate}
					disabled={_props.form.isSaving}
					{...stylex.attrs(
						surfaceStyles.panel,
						styles.newButton,
						styles.libraryNew,
					)}
				>
					<IconPlus size={iconSize.sm} /> New skill
				</button>
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
				<div {...stylex.attrs(styles.libraryHeading)}>
					<select
						aria-label="Filter skills"
						value={_props.filter}
						onInput={(event) => _props.setFilter(event.currentTarget.value)}
						{...stylex.attrs(styles.filter)}
					>
						<option value="all">All skills</option>
						<option value="builtin">Built-in</option>
						<option value="custom">Personal</option>
					</select>
					<span {...stylex.attrs(styles.count)}>{_props.filtered.length}</span>
				</div>
			</div>
			<nav aria-label="Saved skills" {...stylex.attrs(styles.skillList)}>
				{_props.filtered.length === 0 ? (
					<div {...stylex.attrs(styles.emptyList)}>
						<p>
							{_props.loading || _props.filtering
								? "Loading skills…"
								: "No skills found"}
						</p>
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
