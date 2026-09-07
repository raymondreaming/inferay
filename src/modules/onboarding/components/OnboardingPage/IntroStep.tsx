import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { ariaValue } from "../../../../shared/lib/dom.tsx";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import { IconChevronRight } from "../../../../shared/ui/Icons/index.tsx";
import { getStepPhase, type Step } from "../../hooks/useOnboardingStep.tsx";
import { styles } from "./styles.ts";

const logoUrl = "/logo.png";
export function IntroStep(_props: {
	step: Step;
	onNext: () => void;
	onSkip: () => void;
}) {
	const phase = createMemo(() => getStepPhase(_props.step, "intro"));
	return (
		<section
			aria-hidden={ariaValue(_props.step !== "intro")}
			{...stylex.attrs(
				styles.stepSurface,
				styles.stepSurfaceStandard,
				phase() === "active" && styles.stepActive,
				phase() === "before" && styles.introBefore,
				phase() === "after" && styles.introAfter,
			)}
		>
			<div {...stylex.attrs(styles.introStack)}>
				<div {...stylex.attrs(styles.logoFrame)}>
					<img
						src={logoUrl}
						alt=""
						draggable={false}
						{...stylex.attrs(styles.logo)}
					/>
				</div>
				<h1 {...stylex.attrs(styles.heroTitle)}>Welcome to Inferay</h1>
				<p {...stylex.attrs(styles.heroText)}>
					Multi-agent agent workbench. Connect your GitHub, bring in your
					projects, and start building.
				</p>

				<div {...stylex.attrs(styles.primaryActions)}>
					<Button
						type="button"
						onClick={_props.onNext}
						variant="secondary"
						size="lg"
					>
						Get started
						<IconChevronRight size={iconSize.xl} />
					</Button>
				</div>
				<button
					type="button"
					onClick={_props.onSkip}
					{...stylex.attrs(styles.skipButton)}
				>
					Skip setup
				</button>
			</div>
		</section>
	);
}
