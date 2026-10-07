import type {
	ProjectCommand,
	ProjectResource,
	ProjectResourceType,
} from "@contracts";
import { Button } from "@shared/ui/Button/index.tsx";
import { DropdownButton } from "@shared/ui/DropdownButton/index.tsx";
import { TextInput } from "@shared/ui/TextInput/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal } from "solid-js";
import { styles } from "./styles.ts";

export function ResourceEditor(props: {
	projectId: string;
	resource?: ProjectResource;
	initialType?: string;
	brands: ProjectResource[];
	types: ProjectResourceType[];
	save: (command: ProjectCommand) => Promise<void>;
	close: () => void;
	busy: boolean;
}) {
	const [name, setName] = createSignal(props.resource?.name ?? "");
	const [kind, setKind] = createSignal(
		props.resource?.typeId ?? props.initialType ?? "brand.brand",
	);
	const [version, setVersion] = createSignal(
		props.resource?.schemaVersion ?? 1,
	);
	const [body, setBody] = createSignal(
		JSON.stringify(
			props.resource?.body ??
				(props.initialType === "inferay.repository"
					? { location: { base: "external", path: "" }, instructions: "" }
					: { description: "", voice: "" }),
			null,
			2,
		),
	);
	const [error, setError] = createSignal("");
	const [advanced, setAdvanced] = createSignal(false);
	const data = () => {
		try {
			return JSON.parse(body()) as Record<string, unknown>;
		} catch {
			return {};
		}
	};
	function field(key: string, value: unknown) {
		setBody(JSON.stringify({ ...data(), [key]: value }, null, 2));
	}
	const templates: Record<string, unknown> = {
		"brand.brand": { description: "", voice: "" },
		"brand.mind": {
			brandId: props.brands[0]?.id ?? "",
			instructions: "",
			knowledge: [],
		},
		"brand.genome": {
			brandId: props.brands[0]?.id ?? "",
			colors: [],
			typography: [],
			rules: [],
		},
		"inferay.repository": {
			location: { base: "external", path: "/absolute/path/to/repository" },
			instructions: "",
		},
		"inferay.tool": {
			program: "python3",
			entrypoint: { base: "project", path: "tools/main.py" },
			arguments: [],
			workingDirectory: { base: "project", path: "." },
			timeoutSeconds: 300,
			inputSchema: { type: "object" },
			outputSchema: { type: "object" },
		},
	};
	async function submit(event: SubmitEvent) {
		event.preventDefault();
		setError("");
		try {
			await props.save({
				type: "saveResource",
				id: props.resource?.id ?? null,
				expectedRevision: props.resource?.revision ?? null,
				projectId: props.projectId,
				typeId: kind(),
				name: name(),
				body: JSON.parse(body()),
				schemaVersion: version(),
			});
			props.close();
		} catch (e) {
			setError(String(e));
		}
	}
	return (
		<form onSubmit={(e) => void submit(e)} {...stylex.attrs(styles.form)}>
			<strong>{props.resource ? "Edit resource" : "New resource"}</strong>
			<label>
				Name
				<TextInput
					fullWidth
					required
					value={name()}
					onInput={(e) => setName(e.currentTarget.value)}
				/>
			</label>
			<div>
				<span>Type</span>
				<DropdownButton
					label="Resource type"
					value={templates[kind()] ? kind() : `${kind()}@${version()}`}
					disabled={!!props.resource}
					options={[
						...Object.keys(templates).map((type) => ({
							id: type,
							label: type,
						})),
						...props.types.map((type) => ({
							id: `${type.id}@${type.version}`,
							label: `${type.id} · v${type.version}${type.enabled ? "" : " (disabled)"}`,
						})),
						...(props.resource &&
						!templates[props.resource.typeId] &&
						!props.types.some((t) => t.id === props.resource?.typeId)
							? [
									{
										id: `${props.resource.typeId}@${props.resource.schemaVersion}`,
										label: props.resource.typeId,
									},
								]
							: []),
					]}
					onChange={(value) => {
						const [next, revision] = value.split("@");
						setVersion(revision ? Number(revision) : 1);
						setKind(next);
						setBody(JSON.stringify(templates[next] ?? {}, null, 2));
					}}
				/>
			</div>
			{kind().startsWith("brand.") ? (
				<>
					{kind() !== "brand.brand" ? (
						<div>
							<span>Brand</span>
							<DropdownButton
								label="Brand"
								placeholder="Choose a Brand"
								value={String(data().brandId ?? "") || null}
								options={props.brands.map((b) => ({ id: b.id, label: b.name }))}
								onChange={(id) => field("brandId", id)}
							/>
						</div>
					) : null}
					{kind() === "brand.brand" ? (
						<>
							<label>
								Purpose
								<textarea
									value={String(data().description ?? "")}
									onInput={(e) => field("description", e.currentTarget.value)}
									{...stylex.attrs(styles.code)}
								/>
							</label>
							<label>
								Voice
								<TextInput
									fullWidth
									value={String(data().voice ?? "")}
									onInput={(e) => field("voice", e.currentTarget.value)}
								/>
							</label>
						</>
					) : null}
					{kind() === "brand.mind" ? (
						<label>
							Instructions and knowledge
							<textarea
								value={String(data().instructions ?? "")}
								onInput={(e) => field("instructions", e.currentTarget.value)}
								{...stylex.attrs(styles.code)}
							/>
						</label>
					) : null}
					{kind() === "brand.genome" ? (
						<>
							{["colors", "typography", "rules"].map((key) => (
								<label>
									{key}
									<textarea
										value={
											Array.isArray(data()[key])
												? (data()[key] as string[]).join("\n")
												: ""
										}
										onInput={(e) =>
											field(
												key,
												e.currentTarget.value.split("\n").filter(Boolean),
											)
										}
										{...stylex.attrs(styles.code)}
									/>
								</label>
							))}
						</>
					) : null}
					<Button size="sm" onClick={() => setAdvanced(!advanced())}>
						{advanced() ? "Hide JSON" : "Advanced JSON"}
					</Button>
				</>
			) : null}
			{kind() === "inferay.repository" ? (
				<label>
					Repository folder
					<TextInput
						fullWidth
						required
						value={String((data().location as { path?: string })?.path ?? "")}
						onInput={(e) =>
							field("location", {
								base: "external",
								path: e.currentTarget.value,
							})
						}
					/>
				</label>
			) : null}
			{(!kind().startsWith("brand.") && kind() !== "inferay.repository") ||
			advanced() ? (
				<label>
					Resource data
					<textarea
						required
						value={body()}
						onInput={(e) => setBody(e.currentTarget.value)}
						{...stylex.attrs(styles.code)}
					/>
				</label>
			) : null}
			<p {...stylex.attrs(styles.muted)}>
				Saving changes pauses this project’s schedules for review. Create
				reusable skills in the existing Skills library.
			</p>
			{error() ? <p role="alert">{error()}</p> : null}
			<div {...stylex.attrs(styles.row)}>
				<Button size="sm" type="submit" variant="primary" disabled={props.busy}>
					Save resource
				</Button>
				<Button size="sm" onClick={props.close}>
					Cancel
				</Button>
			</div>
		</form>
	);
}
