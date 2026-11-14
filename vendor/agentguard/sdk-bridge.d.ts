/**
 * GitSettle-only type bridge. Upstream rules import two SDK types but execute no
 * SDK code. Keep the original import/source unchanged while resolving those
 * types to the exact vendored SDK definitions; no extra package is installed.
 */
declare module '@agentguard/sdk' {
  export type SpendRequest = import('./sdk/src/types.js').SpendRequest;
  export type Verdict = import('./sdk/src/types.js').Verdict;
}
