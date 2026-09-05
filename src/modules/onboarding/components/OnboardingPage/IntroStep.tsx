import * as stylex from "@octanejs/stylex";
import { resolveServerUrl } from "../../../../adapters/backend/http.ts";
import { getStepPhase, type Step } from "../../../../app/model/appearance.ts";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import { IconChevronRight } from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";

const logoUrl = resolveServerUrl("/logo.png");

export function IntroStep({
	step,
	onNext,
	onSkip,
}: {
	step: Step;
	onNext: () => void;
	onSkip: () => void;
}) {
	const phase = getStepPhase(step, "intro");

	return (
		<section
			aria-hidden={step !== "intro"}
			{...stylex.props(
				styles.stepSurface,
				styles.stepSurfaceStandard,
				phase === "active" && styles.stepActive,
				phase === "before" && styles.introBefore,
				phase === "after" && styles.introAfter,
			)}
		>
			<div {...stylex.props(styles.introStack)}>
				<div {...stylex.props(styles.logoFrame)}>
					<img
						src={logoUrl}
						alt=""
						draggable={false}
						{...stylex.props(styles.logo)}
					/>
				</div>
				<h1 {...stylex.props(styles.heroTitle)}>Welcome to Inferay</h1>
				<p {...stylex.props(styles.heroText)}>
					Multi-agent agent workbench. Connect your GitHub, bring in your
					projects, and start building.
				</p>

				<div {...stylex.props(styles.primaryActions)}>
					<Button type="button" onClick={onNext} variant="secondary" size="lg">
						Get started
						<IconChevronRight size={iconSize.xl} />
					</Button>
				</div>
				<button
					type="button"
					onClick={onSkip}
					{...stylex.props(styles.skipButton)}
				>
					Skip setup
				</button>
			</div>
		</section>
	);
}
