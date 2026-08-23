import { QueryClient } from "@octanejs/tanstack-query";

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
			staleTime: 15_000,
		},
	},
});
