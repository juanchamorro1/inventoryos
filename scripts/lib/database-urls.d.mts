export function resolveDatabaseUrls(env?: Record<string, string | undefined>): {
  mode: "vercel-neon" | "manual";
  appUrl: string | undefined;
  ownerUrl: string | undefined;
  adminUrl: string | undefined;
};
