import * as stylex from "@octanejs/stylex";
import type { Prompt } from "../../../../../build/presentation/contracts/Prompt.ts";
import type { SkillFormState } from "../../../../../build/presentation/contracts/SkillFormState.ts";
import {
	iconSize,
	surfaceStyles,
} from "../../../../design-system/styles.stylex.ts";
import { setInputValue } from "../../../../shared/lib/data.ts";
import { IconPlus, IconSearch } from "../../../../shared/ui/Icons/index.tsx";
import { SkillLibraryItem } from "./SkillLibraryItem.tsx";
import { styles } from "./styles.ts";

export function SkillLibrary({
	startCreate,
	form,
	search,
	setSearch,
	filter,
	setFilter,
	filtered,
	loading,
	filtering,
	selectedId,
	selectSkill,
}: {
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
		<aside aria-label="Skills library" {...stylex.props(styles.listPane)}>
			<div {...stylex.props(styles.libraryControls)}>
				<button
					type="button"
					onClick={startCreate}
					disabled={form.isSaving}
					{...stylex.props(
						surfaceStyles.panel,
						styles.newButton,
						styles.libraryNew,
					)}
				>
					<IconPlus size={iconSize.sm} /> New skill
				</button>
				<div {...stylex.props(styles.searchWrap)}>
					<IconSearch size={iconSize.md} {...stylex.props(styles.searchIcon)} />
					<input
						type="search"
						value={search}
						onInput={setInputValue.bind(null, setSearch)}
						placeholder="Find a skill…"
						aria-label="Search skills"
						{...stylex.props(styles.searchInput)}
					/>
				</div>
				<div {...stylex.props(styles.libraryHeading)}>
					<select
						aria-label="Filter skills"
						value={filter}
						onChange={(event) => setFilter(event.currentTarget.value)}
						{...stylex.props(styles.filter)}
					>
						<option value="all">All skills</option>
						<option value="builtin">Built-in</option>
						<option value="custom">Personal</option>
					</select>
					<span {...stylex.props(styles.count)}>{filtered.length}</span>
				</div>
			</div>
			<nav aria-label="Saved skills" {...stylex.props(styles.skillList)}>
				{filtered.length === 0 ? (
					<div {...stylex.props(styles.emptyList)}>
						<p>
							{loading || filtering ? "Loading skills…" : "No skills found"}
						</p>
						<span>
							{search
								? "Try another name or command."
								: "Create a skill to get started."}
						</span>
					</div>
				) : (
					filtered.map((skill) => {
						const active = !form.isCreating && selectedId === skill._id;
						return (
							<SkillLibraryItem
								key={skill._id}
								skill={skill}
								active={active}
								selectSkill={selectSkill}
							/>
						);
					})
				)}
			</nav>
		</aside>
	);
}
