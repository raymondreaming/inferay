import type { ForgeAccount, GithubRepo } from "../adapters/types.ts";

export function areForgeAccountsEqual(
	previous: readonly ForgeAccount[],
	next: readonly ForgeAccount[],
) {
	return (
		previous.length === next.length &&
		previous.every((account, index) => {
			const candidate = next[index];
			return (
				candidate !== undefined &&
				account.provider === candidate.provider &&
				account.host === candidate.host &&
				account.login === candidate.login &&
				account.name === candidate.name &&
				account.avatarUrl === candidate.avatarUrl &&
				account.email === candidate.email &&
				account.active === candidate.active
			);
		})
	);
}

export function areGithubReposEqual(
	previous: readonly GithubRepo[],
	next: readonly GithubRepo[],
) {
	return (
		previous.length === next.length &&
		previous.every((repository, index) => {
			const candidate = next[index];
			return (
				candidate !== undefined &&
				repository.name === candidate.name &&
				repository.full_name === candidate.full_name &&
				repository.description === candidate.description &&
				repository.html_url === candidate.html_url &&
				repository.language === candidate.language &&
				repository.stargazers_count === candidate.stargazers_count &&
				repository.updated_at === candidate.updated_at &&
				repository.private === candidate.private
			);
		})
	);
}
