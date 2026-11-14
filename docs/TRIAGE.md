# Advisory preflight and optional AI

GitSettle ships deterministic duplicate/spam preflight and an optional operator-configured AI helper. Both help people review work. Neither can fund a bounty, reject a submission, approve a release, refund a reward, resolve an appeal, or change on-chain state. Automatic payment still uses the [trusted verifier](../services/verifier/README.md), contract access control, and [AgentGuard rules](AGENTGUARD.md).

The backend lives in `packages/triage`; the thin Next.js route adapters are `apps/web/src/app/api/triage/route.ts` and `apps/web/src/app/api/ai/chat/route.ts`. Wallet identity and origin checks reuse [community authentication](COMMUNITY.md). Shared canonical issue/PR matching lives in `packages/shared/src/dedupe.ts`, so preflight and verifier duplicate checks use the same identity rules.

## Deterministic checks

- An active bounty with the same canonical issue URL, work type, and normalized locale is flagged as a possible duplicate. Separate locales and completed/refunded work do not match. Expired open/claimed/rejected work is excluded; submitted work remains protected and is included while verification is pending. Several funders can intentionally fund the same issue, so this is a warning for human review.
- Automatic release separately pauses for a PR used by another submitted, releasing, or paid bounty. A human poster can still authorize release under the contract's trust model.
- Text with more than ten links, the same link repeated at least four times, long lines repeated at least three times, forty repeated nonspace characters, or invisible/directional controls receives an explanatory signal. These heuristics can produce false positives and cannot establish malicious intent.
- Invalid repository/issue identity, a mismatched repository, missing translation locale, a closed issue, or a GitHub issue number that actually denotes a PR is shown for review.
- Issue inspection reconstructs a URL under `https://api.github.com/repos/.../issues/...`. It never fetches an arbitrary supplied origin, follows redirects, or forwards browser credentials. Requests use GitHub REST version `2026-03-10`, a four-second timeout, and a 65,536-byte response limit. Only public GitHub issue data is inspected; rate limits and outages produce an advisory unavailable signal.

The preflight does not lock a work identity on-chain. It reads the board's available snapshot, and results can be cached for five minutes. Another bounty can be posted after a check. A `ready` recommendation means no configured heuristic requested review; it does not prove originality, eligibility, safe code, or payment authorization.

## API

All responses set `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. Errors are `{ "error": { "code": "...", "message": "..." } }`. Error text never includes upstream provider bodies, database details, session credentials, or configured API keys. Request streams are limited to 40,000 bytes, including when `Content-Length` is missing or incorrect.

### `POST /api/triage`

Public deterministic checks accept JSON:

```json
{
  "repo": "CodeMasterLabs/gitsettle",
  "issue_url": "https://github.com/CodeMasterLabs/gitsettle/issues/7",
  "bounty_type": "Translation",
  "target_locale": "es",
  "text": "Translate the settings page and navigation into Spanish.",
  "useAi": false
}
```

`bounty_type` is `Bug`, `Feature`, `Audit`, `Translation`, or `Other`. Locale and text are optional; text is limited to 8,000 characters. `includeAi` is accepted as a compatibility alias for `useAi`. Reward/deadline fields and request-selected model, provider, credential, or system-prompt fields are ignored. Locale is normalized to lowercase.

```json
{
  "duplicateBountyIds": [],
  "signals": [],
  "recommendation": "ready",
  "aiConfigured": false
}
```

`recommendation` is `ready`, `review`, or `duplicate`. Signals carry `code`, `severity` (`info`, `warning`, or `high`), and human-readable `message`.

With `useAi: true`, the caller must have a verified wallet session and use the configured site origin. A successful provider response adds `ai: { summary, risks, suggestedActions }`. A missing provider or provider failure preserves the deterministic result and adds `aiError: { code, message }`. Authentication and exhausted quota return HTTP 401/403/429 rather than calling the provider.

### `GET /api/ai/chat`

Returns `{ "configured": false }` or `{ "configured": true, "model": "configured-model" }`. This public endpoint never reveals the provider URL or credential.

### `POST /api/ai/chat`

Requires a signed wallet session and a same-origin request:

```json
{
  "message": "What happens after my pull request is merged?",
  "history": [{ "role": "assistant", "content": "You can submit a canonical PR URL." }],
  "bountyId": 3
}
```

History is optional, accepts only `user`/`assistant` roles, and is limited to nine earlier messages. All messages together are limited to 8,000 characters. The original `{ "messages": [...] }` envelope is also accepted if its final message has role `user`. An optional nonnegative safe-integer `bountyId` adds a small allowlist of contract view fields; unavailable views are explicitly marked unavailable.

Returns `{ "configured": true, "model": "configured-model", "reply": "..." }`. An unconfigured instance returns HTTP 503 with `ai_not_configured`; ordinary support remains usable. A provider failure returns a safe 502 error.

## Operator configuration and limits

Leave all AI settings blank for deterministic preflight and ordinary support only. To enable the helper, configure these **server-only** environment values and restart the web service:

```dotenv
LLM_BASE_URL=https://your-provider.example/v1
LLM_API_KEY=replace-with-your-provider-key
LLM_MODEL=your-model-id
```

The example key above is a placeholder. Never commit real keys. Compose gives the optional provider key only to the web service; it does not give the web service the verifier's NEAR signing key. Configure `APP_ORIGIN` to the exact browser origin so signed-session CSRF checks work.

The endpoint must support OpenAI-compatible **Chat Completions**, `max_completion_tokens`, and strict `response_format.json_schema`. The client appends `/chat/completions` to the configured base. HTTPS is required except for loopback development endpoints (`localhost`, `127.0.0.1`, or `[::1]`). URLs containing credentials, query strings, or fragments are rejected. Redirects are disabled. Compatibility varies between providers; an unsupported schema produces a safe failure rather than an unstructured-output fallback.

The implementation was checked against the official [Chat Completions create reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create/) on November 14, 2026. GitHub references are recorded in [API_SOURCES.md](API_SOURCES.md).

Limits are deliberately simple for a self-hosted MVP:

| Boundary | Enforced limit |
| --- | --- |
| Public preflight | 20 checks per minute per trusted-proxy address; 2,000 in-process address buckets |
| Deterministic cache | 200 entries per process, five-minute expiry; contract/origin namespace |
| Billable AI | 20 attempts per verified wallet per UTC day, shared by review/chat |
| AI persistence | Atomic SQLite quota in `DATABASE_PATH`, retained for roughly 31 days; separated by contract/origin namespace |
| Provider call | 15-second timeout, 65,536-byte response bound, 800 maximum completion tokens |
| AI context | 8,000 input text characters, bounded excerpts/contract fields, 16,384 serialized context characters |
| Accepted output | One completed assistant choice; strict field, type, string, and array limits |

Provider failures count toward the daily quota because they may have consumed billed work. SQLite immediate transactions coordinate multiple web processes using the same database. Public caches and IP limits are per process; distributed deployments need a shared limiter. Wallet quotas do not prevent one person from using multiple wallets. Set provider-side budget limits according to the operator's risk tolerance.

By default the app ignores `X-Forwarded-For`, so direct requests share one public-preflight bucket. Set `TRUST_PROXY_HEADERS=true` only behind a trusted proxy that replaces that header, and prevent users from reaching the app port directly. For the documented Caddy VPS setup, bind the application to `127.0.0.1` and expose only Caddy. Misconfiguring this setting permits callers to rotate the address used by the public limiter. It does not bypass wallet authentication or persistent AI quotas.

## Privacy and AI trust boundary

When AI is explicitly requested, selected input is sent to the operator's configured provider: candidate context and public issue excerpts for review, or the question, supplied conversation history, and selected bounty fields for chat. The provider also sees the server's authentication credential and fixed product instructions. Do not submit private keys, seed phrases, session cookies, confidential reports, or other secrets in questions. The operator controls provider choice and its retention policy.

GitSettle sends `store: false`, but this is a provider API preference, not an independent retention guarantee. The application does not persist AI prompts or answers. The deterministic cache holds bounded public issue evidence and deterministic signals, never AI answers. SQLite stores only namespace, wallet ID, UTC day, and attempt count for AI quotas. The chat route does not inspect private support-ticket threads.

Issue text, history, and questions are JSON-quoted as untrusted data under fixed system instructions. No tools, functions, signing capabilities, or autonomous actions are exposed to the model. Truncated completions, refusals, tool/function calls, malformed JSON, extra response fields, and oversized outputs are rejected. Accepted strings redact the exact configured provider key. These controls constrain the interface; they cannot guarantee factual answers or eliminate prompt injection. Human-readable AI output remains advice even if it incorrectly claims otherwise.

## Validation and handoff

Run `npx tsx --test packages/triage/src/*.test.ts` or the full `npm test`. The focused suite contains 33 tests covering canonical matching, heuristics, fixed-origin GitHub inspection, input/stream bounds, cache privacy, IP limits, SQLite quota persistence across connections, auth/quota enforcement, context allowlists, strict provider parsing, failures, and credential redaction. `npm run typecheck` also passes.

Provider tests inject mock HTTP responses; no live paid provider call or live LLM behavior is claimed. A deployment without an LLM key should expose `configured: false`, continue to run deterministic preflight, and direct users to ordinary support.
