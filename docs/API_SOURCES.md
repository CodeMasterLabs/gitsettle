# Verified API and dependency sources

Checked on **2026-11-14**, before implementing the corresponding integrations. Versions below came from `npm view <package> version`; API signatures were cross-checked against the published package tarballs (`npm pack`) and the official documentation/source. Dependencies are pinned in package manifests and the root lockfile.

## JavaScript versions

| Package | Verified version | Notes |
| --- | --- | --- |
| `near-api-js` | `7.5.3` | Node **22.22.2+**; use the v7 single-package API for server-side signing. |
| `@near-wallet-selector/core` | `10.1.4` | v10 requires NEAR action objects, not v9 plain action descriptors. |
| `@near-wallet-selector/modal-ui` | `10.1.4` | Declares React peer `>=18`; its own modal uses React 18.3.1. |
| `@near-wallet-selector/my-near-wallet` | `10.1.4` | Browser redirect wallet; testnet URL is `https://testnet.mynearwallet.com`. |
| `next` | `16.4.6` | Node `>=20.9`; React 19 is supported. |
| `react`, `react-dom` | `19.3.1` | Application React version. |
| `tailwindcss`, `@tailwindcss/postcss` | `4.3.5` | v4 PostCSS package is separate. |
| `drizzle-orm` | `0.45.4` | SQLite persistence through the better-sqlite3 adapter. |
| `better-sqlite3` | `13.1.1` | Node `>=22`; native module needs a compatible build toolchain. |
| `typescript` | `7.0.2` | Current registry release when checked. |
| `tsx` | `4.23.15` | TypeScript service/script execution. |
| `@playwright/test` | `1.65.1` | Browser smoke tests and screenshots. |
| `near-cli-rs` | `0.31.1` | Optional deployment/account CLI. |

Use Node 22.22.2 or later for the whole monorepo. The installed environment used Node 22.23.0.

### NEAR JavaScript v7

Sources:

- [NEAR API documentation](https://docs.near.org/tools/near-api)
- [Official v7 README and examples](https://github.com/near/near-api-js/blob/master/README.md)
- [Published TypeDoc](https://near.github.io/near-api-js/)
- Published `near-api-js@7.5.3` types: `lib/index.d.ts`, `lib/account-BlZEm07p.d.ts`.

```ts
import { Account, JsonRpcProvider, teraToGas, type KeyPairString } from 'near-api-js';

const provider = new JsonRpcProvider({ url: rpcUrl });
const bounty = await provider.callFunction({
  contractId,
  method: 'get_bounty',
  args: { id: 0 },
  blockQuery: { finality: 'final' },
});

const verifier = new Account(verifierAccountId, provider, privateKey as KeyPairString);
const outcome = await verifier.callFunctionRaw({
  contractId,
  methodName: 'release',
  args: { id: 0 },
  deposit: 0n,
  gas: teraToGas('100'),
  waitUntil: 'FINAL',
});
```

`provider.callFunction` is a view method and takes **`method`**. `account.callFunctionRaw` signs a transaction and takes **`methodName`**. Gas/deposit are `bigint`, expressed in gas units/yoctoNEAR. `callFunction` returns the decoded method result; `callFunctionRaw` preserves transaction hash, logs and receipt outcomes. Default transaction wait is `EXECUTED_OPTIMISTIC`, so settlement code explicitly waits for `FINAL` and re-reads contract state. A resolved callback transaction alone does not prove a payout succeeded: the contract's transfer callback controls `Released` and points.

The library does not read environment credentials itself. Private keys stay in service/script environment variables; never expose them through Next.js public config.

### Wallet Selector v10

Sources:

- [v10 migration guide](https://github.com/near/wallet-selector/blob/main/MIGRATION-v10.md)
- [Core setup](https://github.com/near/wallet-selector/blob/main/packages/core/README.md)
- [Modal setup/styles](https://github.com/near/wallet-selector/blob/main/packages/modal-ui/README.md)
- [My NEAR Wallet options](https://github.com/near/wallet-selector/blob/main/packages/my-near-wallet/README.md)
- Published `@near-wallet-selector/core@10.1.4` types: `src/lib/wallet/wallet.types.d.ts`, `src/lib/store.types.d.ts`.

```ts
import { actionCreators, setupWalletSelector } from '@near-wallet-selector/core';
import { setupModal } from '@near-wallet-selector/modal-ui';
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet';
import '@near-wallet-selector/modal-ui/styles.css';

const selector = await setupWalletSelector({
  network: 'testnet',
  modules: [setupMyNearWallet()],
});
const modal = setupModal(selector, { contractId, theme: 'light' });
modal.show();

const wallet = await selector.wallet();
await wallet.signAndSendTransaction({
  receiverId: contractId,
  actions: [actionCreators.functionCall('claim_bounty', { id: 0 }, 100000000000000n, 0n)],
});
```

Initialize only in the browser. Observe `selector.store.observable` for account changes and unsubscribe on teardown. The `BrowserWallet` transaction method may return **`void`** because it redirects. Preserve pending action metadata before signing; verify `transactionHashes` from the wallet return against RPC and actual contract state before displaying confirmation. Never infer success from a redirect or URL parameter alone. A payable create transaction must attach reward **plus** the contract's storage reserve, using exact integer arithmetic.

## GitHub REST API

Sources:

- [API versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions)
- [Get a pull request](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request)
- [Check whether a pull request has been merged](https://docs.github.com/en/rest/pulls/pulls#check-if-a-pull-request-has-been-merged)
- [List pull request files](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files)
- [Issue linking and closing keywords](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue)
- [REST pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api)

Current documented API version is **`2026-03-10`**. Requests explicitly send `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2026-03-10`, and a descriptive `User-Agent`. Optional token: `Authorization: Bearer …`. Restrict request origins to `https://api.github.com`; do not fetch arbitrary user-supplied PR URLs with a token.

Relevant endpoints:

```text
GET /repos/{owner}/{repo}/pulls/{pull_number}
GET /repos/{owner}/{repo}/pulls/{pull_number}/merge
GET /repos/{owner}/{repo}/pulls/{pull_number}/files?per_page=100&page=1
GET /repos/{owner}/{repo}/issues/{issue_number}
```

For the PR object, verify `merged === true`, non-null `merged_at`, `base.repo.full_name` equal to the bounty repository, matching PR number/canonical URL, and a closing reference to the exact issue in `body`. The merge-check endpoint is `204` if merged, `404` otherwise. When the optional `merge_commit_sha` audit field is null or omitted, GitSettle additionally requires that endpoint to return exactly **204**. A conflicting 404, unexpected 200, outage, or rate limit remains an operational error and cannot authorize payout or reject the contribution. Evidence records `merge_sha: null`; it never substitutes a head commit or invents a merge SHA.

This behavior was checked against real [PR #10](https://github.com/CodeMasterLabs/gitsettle/pull/10) on November 14, 2026: the `2026-03-10` response omitted `merge_commit_sha` entirely, while the default older API returned it. Both supplied the required merged timestamp, repository, issue/account body evidence, and changed-file metadata; `/pulls/10/merge` returned 204. An allowlisted regression fixture retains only public verification fields, the two evidence lines, and file summaries in `services/verifier/src/fixtures/github-2026-pr10.json`. The real read-only policy check passed with `merge_sha: null` and `locales/es/contributing.md`; that check did not submit or release a bounty.

GitHub issue-closing semantics apply only when merging to the default branch. GitSettle's oracle checks an explicit reference; it does not claim GitHub closed the issue unless that separate fact is checked.

Recognized GitHub closing words are `close`, `closes`, `closed`, `fix`, `fixes`, `fixed`, `resolve`, `resolves`, `resolved`, case-insensitive with an optional colon. Same-repository references use `#123`; qualified references use `owner/repo#123`. GitSettle may also recognize a canonical issue URL. Match number boundaries so `#12` never matches `#123`, and repository boundaries so a qualified reference cannot accidentally match another repository.

A claimant cannot prove ownership by merely submitting someone else's PR URL. Require an exact standalone, visible PR-body line:

```text
GitSettle: <contract_id>/<bounty_id>/<claimant_account_id>
```

This binds the PR to this contract, bounty, and NEAR recipient. It is evidence under the trusted-oracle model, **not a cryptographic GitHub identity proof**: PR bodies can be edited by the PR author and authorized maintainers. The oracle does not determine translation quality or security correctness.

The implemented closing reference starts a plain body line or an unordered list
item. Comments, blockquotes and code examples do not supply evidence. A merge
timestamp must be at or after on-chain bounty creation, preventing retroactive
rebinding of a historical merge. An older open PR can still finish funded work.

Translation validation scans the returned changed-file paths for an exact expected locale segment in an allowed i18n/localization directory (for example `locales/es/messages.json`, `src/i18n/bn/common.json`, `public/locales/ja/ui.json`). It rejects removed-only changes and substring matches such as locale `es` matching `es-MX`. GitHub files pages default to 30 and cap at **3000 files total**. Fetch with `per_page=100`, verify completeness against `changed_files`, and refuse automatic payout if incomplete/over cap. Use a bounded request timeout, rate-limit-aware retries and a maximum page count.

Open/unmerged PRs remain pending even after a deadline: a valid timely submission must continue protecting the claimant from refund. HTTP 403/429, outages, malformed API data, and partial pagination are retryable operational failures, never proof a submission is invalid. Only definite mismatches may be rejected, and only through the contract's verifier-authorized path.

## Testnet account creation

Sources:

- [near-cli-rs guide](https://github.com/near/near-cli-rs/blob/main/docs/GUIDE.en.md#sponsor-by-faucet-service---I-would-like-the-faucet-service-sponsor-to-cover-the-cost-of-creating-an-account-testnet-only-for-now)
- [Faucet implementation](https://github.com/near/near-cli-rs/blob/main/src/commands/account/create_account/sponsor_by_faucet_service/mod.rs)
- [Default network config](https://github.com/near/near-cli-rs/blob/main/src/config/mod.rs)

```sh
npx near-cli-rs@0.31.1 account create-account \
  sponsor-by-faucet-service YOUR-UNIQUE-NAME.testnet \
  autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
```

The official implementation posts JSON to `https://helper.nearprotocol.com/account` with `newAccountId` and `newAccountPublicKey`. Generate keys locally and persist with restrictive permissions before requesting funding. Only the public key goes to the faucet. Verify the resulting account and key through testnet RPC. This creates a **testnet** development account, never a mainnet prize account. Availability and free balance are controlled by the public faucet.

## Web and persistence

- [Next.js installation/App Router](https://nextjs.org/docs/app/getting-started/installation)
- [Tailwind with Next.js](https://tailwindcss.com/docs/guides/nextjs)
- [Drizzle SQLite setup](https://orm.drizzle.team/docs/get-started/sqlite-new)
- [Drizzle better-sqlite3 connection](https://orm.drizzle.team/docs/connect-sqlite#better-sqlite3)

SQLite is a rebuildable read-model/audit store. The NEAR contract is authoritative for reward custody, bounty state, access control, and earned points. Demo fixture rows must be visibly labeled and must never be mixed with live chain balances.
