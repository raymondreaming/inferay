import type { SkillLibraryRow } from "@contracts";
import { iconSize } from "@design-system/styles.stylex.ts";
import { ariaValue, setInputValue } from "@shared/lib/dom.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { IconPlus, IconSearch } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import { styles } from "./styles.ts";

export function SkillLibrary(_props: {
	startCreate: () => void;
	busy: boolean;
	search: string;
	setSearch: (value: string) => void;
	rows: SkillLibraryRow[];
	loading: boolean;
	selectSkill: (id: string) => void;
}) {
	return (
		<aside aria-label="Skills library" {...stylex.attrs(styles.listPane)}>
			<div {...stylex.attrs(styles.libraryControls)}>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					onClick={_props.startCreate}
					disabled={_props.busy}
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
				<span {...stylex.attrs(styles.count)}>{_props.rows.length}</span>
			</div>
			<nav aria-label="Saved skills" {...stylex.attrs(styles.skillList)}>
				{_props.rows.length === 0 ? (
					<div {...stylex.attrs(styles.emptyList)}>
						<span>
							{_props.loading ? "Loading skills…" : "No skills found"}
						</span>
						<span>
							{_props.search
								? "Try another name or command."
								: "Create a skill to get started."}
						</span>
					</div>
				) : (
					<For each={_props.rows} keyed={(row) => row._id}>
						{(skill) => (
							<button
								type="button"
								disabled={_props.busy}
								onClick={() => _props.selectSkill(skill()._id)}
								aria-current={ariaValue(skill().active ? "true" : undefined)}
								title={skill().description}
								{...stylex.attrs(
									styles.skillRow,
									skill().active && styles.skillRowActive,
								)}
							>
								<span {...stylex.attrs(styles.skillCopy)}>
									<span {...stylex.attrs(styles.skillCommand)}>
										/{skill().command}
									</span>
									<span {...stylex.attrs(styles.skillDescription)}>
										{skill().description}
									</span>
								</span>
								{skill().isBuiltIn && (
									<span {...stylex.attrs(styles.builtinLabel)}>Built-in</span>
								)}
							</button>
						)}
					</For>
				)}
			</nav>
		</aside>
	);
}
