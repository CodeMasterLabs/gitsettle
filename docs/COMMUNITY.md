# Wallet-authenticated support and appeals

GitSettle support is a private discussion system, separate from the escrow contract. A signed NEAR wallet message identifies the participant. A connected wallet alone is **not** authentication. A wallet without NEP-413 `signMessage` support cannot open a session; there is no anonymous or demo-identity fallback.

An appeal records evidence and discussion. It **never** changes a bounty's status, deadline, claimant, reward, refund eligibility, verifier policy, or payout. Marking a ticket resolved closes a conversation; it does not resolve an on-chain dispute. Maintainers still use the existing authorized contract actions separately.

## Operator configuration

```dotenv
# Exact origin: no trailing slash or path. HTTPS outside local development.
APP_ORIGIN=https://gitsettle.89.167.109.196.sslip.io
# Optional comma-separated wallets; defaults to NEAR_CONTRACT_ID.
SUPPORT_ADMIN_ACCOUNTS=gitsettle-ac1b0f23f4.testnet
DATABASE_PATH=/data/gitsettle.sqlite
NEAR_CONTRACT_ID=gitsettle-ac1b0f23f4.testnet
NEAR_RPC_URL=https://rpc.testnet.near.org
DEMO_MODE=false
```

For native local development, the origin defaults to `http://localhost:3000`. Production requires an explicit origin. `http://localhost:3000` and other loopback hosts may be configured for local Docker use. Arbitrary HTTP origins, user information in URLs, paths, query strings, and trailing slashes are rejected. Forwarded headers never determine the signing domain or allowed mutation origin. Set the public HTTPS origin when running behind Caddy.

The web process opens its own `better-sqlite3` connection to the existing database, with WAL, foreign keys, and a five-second busy timeout. Startup adds `community_challenges`, `community_sessions`, `community_tickets`, and `community_messages` and supporting indexes without changing the escrow metadata tables. Back up SQLite consistently using its backup facility or a stopped service; copy neither an active main database alone nor private logs into the repository. Namespace keys include testnet, contract account, and canonical origin, isolating sessions and conversations between deployments.

## Authentication

1. `POST /api/auth/challenge` receives `{ "accountId": "alice.testnet" }`. The server returns `{ "challenge": { "challengeId", "state", "message", "nonce", "recipient", "callbackUrl", "expiresAt" } }`. `nonce` is 32 random bytes encoded as base64, `recipient` is the configured host, and `callbackUrl` is the configured origin plus `/support`. The message also names the wallet, origin, and expiry. A separate random browser token is placed in an HttpOnly cookie; only its hash is stored with the challenge.
2. The client passes the exact payload to Wallet Selector `wallet.signMessage`. The nonce must be decoded into a 32-byte `Buffer`. The `state` value equals `challengeId`. The payload is valid for five minutes and is signed using NEP-413's Borsh encoding, domain tag `2**31 + 413`, SHA-256, and Ed25519.
3. A direct result contains `accountId`, `publicKey`, and a base64 `signature`. Browser wallets can instead redirect to `/support#accountId=...&publicKey=...&signature=...&state=...`. The client reads and immediately removes the fragment; the signature must never be placed in a query string, analytics event, or log. Wallet errors can return `#error=...&state=...`.
4. `POST /api/auth/session` receives `{ "challengeId", "accountId", "publicKey", "signature" }`. The challenge must match the original browser cookie and account, remain unexpired, and be unused. One atomic SQLite update consumes it before verification, so competing submissions cannot both succeed. Signature failure or RPC failure requires a fresh challenge.
5. The server uses `near-api-js/nep413` to verify the signature and check the key. An adapter explicitly forces `viewAccessKey(... finalityQuery: { finality: 'final' })`; the SDK otherwise defaults to optimistic key state. Only an active Ed25519 **FullAccess** key is accepted.
6. Success returns `{ "session": { "accountId", "expiresAt", "isAdmin" } }`. A new random 256-bit session token goes only into an HttpOnly, SameSite=Lax cookie; only its SHA-256 hash is stored in SQLite. HTTPS cookies use the `__Host-` prefix, `Secure`, `Path=/`, and no Domain. Sessions expire after eight hours, and a new sign-in rotates the current session.
7. `GET /api/auth/session` returns that envelope or `{ "session": null }`. Every authenticated operation rechecks the original signing key at finalized NEAR state. Key removal or permission downgrade ends the session; RPC failure denies access without deleting the session. `DELETE /api/auth/session` logs out and clears cookies.

Every mutation requires an exact matching `Origin` header and rejects cross-site Fetch Metadata. JSON request bodies are bounded to 32 KiB while streaming; content type must be `application/json`. All responses use `Cache-Control: no-store`. No signatures, session tokens, private keys, raw provider errors, or message bodies are logged by this package. Browser tokens, nonce challenges, and sessions expire; expired session rows are cleaned when new challenges are created. Authentication attempts are limited to ten per account in five minutes and 120 per minute per deployment namespace, with issuance checks and writes in one atomic transaction. Expired challenges are removed at their five-minute expiry when new challenges are requested; rotating invented accounts cannot grow the challenge table without bound.

## Ticket access and API

Authenticated identity comes exclusively from the session. A request's `accountId`, `creatorAccount`, `authorAccount`, `claimant`, or `isAdmin` cannot change permissions.

| Operation | Endpoint and input | Response |
| --- | --- | --- |
| List accessible conversations | `GET /api/tickets` | `{ tickets: Ticket[] }` |
| Open conversation | `POST /api/tickets` with `{ kind, subject, body, bountyId? }` | `{ ticket, messages }` (201) |
| Read conversation | `GET /api/tickets/:id` | `{ ticket, messages }` |
| Reply | `POST /api/tickets/:id/messages` with `{ body }` | `{ ticket, messages }` (201) |
| Review or resolve | `PATCH /api/tickets/:id` with `{ status: "in_review" \| "resolved" }` | `{ ticket, messages }` |

`Ticket` contains `id`, `kind`, `subject`, `bountyId`, `creatorAccount`, `posterAccount`, `status`, ISO `createdAt`/`updatedAt`, `messageCount`, and `permissions: { canReply, canReview, canResolve }`. Messages contain `id`, `ticketId`, `authorAccount`, `body`, and ISO `createdAt`. Public TypeScript types live in `@gitsettle/community/types`. Detail responses can be polled every 10–15 seconds while the conversation is open.

- **Support:** any authenticated wallet can create it. Only its creator and configured support administrators can read/reply. `bountyId` is omitted.
- **Appeal:** requires a real bounty read from the configured testnet contract at finalized state, the authenticated wallet as its actual claimant, and status `Submitted` or `Rejected`. Its immutable on-chain poster also gains read/reply/review/resolve access. Demo data is never used to authorize an appeal.
- **States:** new conversations are `open`. Administrators and an appeal's bounty poster may set `in_review` or `resolved`; the creator may set `resolved`. Resolved conversations are terminal and cannot receive more replies.
- **Privacy:** unauthorized and nonexistent ticket IDs both return 404. Administrators can see all conversations in their configured deployment. General support is never shared with unrelated bounty posters.
- **Limits:** subjects are 1–120 characters; messages 1–4,000. Creation is limited to three tickets/hour/account, including closed tickets. All message writes, including a ticket's initial message, count toward twenty/minute/account. Unicode-normalized, case-insensitive repeated text across that author's conversations is rejected for an hour. One unresolved appeal per bounty/claimant is allowed. Rate checks, duplicate checks, and writes share an IMMEDIATE SQLite transaction.

Errors consistently return `{ "error": { "code", "message" } }`: 400 malformed input, 401 missing/invalid authentication, 403 origin/permission failure, 404 hidden/missing resource, 409 state/duplicate conflict, 413 oversized request, 415 incorrect content type, 429 rate limit, and 503 infrastructure/configuration failure. These messages are safe for the UI; raw exceptions are not exposed.

## Limits and handoff

This is a centralized self-hosted support inbox. Ticket messages are stored as plaintext in the operator's SQLite database and remain until the operator applies a retention policy. It is not end-to-end encrypted, an arbitration mechanism, or a guarantee of a response. Its availability depends on the web service, SQLite, and testnet RPC. The newest 100 accessible tickets are listed; an individual thread is capped at 500 messages. Future pagination, notifications, retention controls, and distributed rate limiting belong in a larger deployment. Deterministic spam controls are local safeguards, not semantic moderation; optional AI advice has no authority over ticket persistence or escrow.

Implementation is divided into `auth.ts` (NEP-413/session lifecycle), `tickets.ts` (ACL and discussion transitions), `store.ts` (additive tables), `http.ts` (same-origin/cookie/JSON boundary), and `server.ts` (production dependencies). The HTTP adapter exports `requireSession(request)` for other private tools; it applies the same origin and finalized-key rules and returns only the public session identity. Dependencies and time are injectable for offline tests. No component imports a transaction signer.

Validation: `npx tsx --test packages/community/src/*.test.ts` has **32 tests** covering genuine SDK-generated NEP-413 signatures, altered payloads, replay races, expiry, browser/account binding, revoked/limited keys, RPC failure, opaque session storage, rotation/logout (including logout or expiry during a slow key read), CSRF, body limits, session-derived identity, ownership/ACL isolation, rate limits, duplicate spam, every ticket status transition, and persistence/rate enforcement across two WAL connections.

For real HTTP and testnet-key verification, start the current web build with the live contract and an exact matching `APP_ORIGIN`, then run:

```bash
SUPPORT_BASE_URL=http://127.0.0.1:3000 npx tsx scripts/verify-support.ts --run
```

This reads the existing ignored development wallets, signs messages in memory, checks finalized FullAccess keys, creates one clearly labeled support test conversation as the contributor, replies and resolves it, proves the unrelated verifier wallet cannot read/reply/resolve/list it, and logs both sessions out. It also checks nonce replay, account-field spoofing, anonymous requests, and cross-origin rejection. It sends **zero NEAR transactions** and creates no appeal. Only a fully passing run writes `docs/COMMUNITY_E2E.json`, containing public identifiers and check results without cookies, signatures, or message bodies. Re-running creates another support test conversation and counts toward normal rate limits. `--help` reads no keys and performs no network calls. API proof does not establish interactive wallet popup/redirect behavior; that is covered separately by browser checks.

Verified protocol/API references (November 14, 2026):

- [NEP-413, final standard](https://github.com/near/NEPs/blob/master/neps/nep-0413.md)
- [`near-api-js` documentation](https://docs.near.org/tools/near-api) and installed 7.5.3 `nep413`/`Provider.viewAccessKey` declarations and implementation
- [Wallet Selector](https://github.com/near/wallet-selector) and installed 10.1.4 `SignMessageParams`/`SignedMessage` declarations
