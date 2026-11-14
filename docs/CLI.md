# GitSettle CLI

The `@gitsettle/cli` workspace provides a real `gitsettle` executable for viewing,
funding, claiming, submitting, releasing, and refunding native-NEAR bounties.
It uses the same shared money/contract types and transaction confirmation logic
as the web application. It supports **NEAR testnet only**.

## Run or install the executable

Use Node **22.22.2 or newer** from the public checkout:

```sh
git clone https://github.com/CodeMasterLabs/gitsettle.git
cd gitsettle
npm ci
npm run cli -- --help
```

For read-only access from a running Docker installation:

```sh
docker compose exec web npm run cli -- list
```

The explicit workspace form works without the root shortcut:

```sh
npm exec --workspace @gitsettle/cli -- gitsettle --help
```

For a bare executable on your PATH, link this local checkout:

```sh
npm link --workspace @gitsettle/cli
gitsettle --version
```

Keep the checkout and its installed dependencies in place. This is a local
workspace package, not a claim that an independently installable package has
been published to npm. The executable launcher has a Node shebang and mode
`0755`; it loads the packaged TypeScript entrypoint using `tsx`'s `tsImport` API.

## Defaults and read-only commands

The default contract is `gitsettle-ac1b0f23f4.testnet`. The default RPC is
`https://test.rpc.fastnear.com`, listed in the official
[NEAR RPC providers documentation](https://docs.near.org/api/rpc/providers).
The CLI checks the endpoint's reported chain before making contract calls.
Override with `--contract` / `NEAR_CONTRACT_ID` and `--rpc` / `NEAR_RPC_URL`.
Only named accounts ending in `.testnet` are accepted.

```sh
gitsettle list
gitsettle list --type Translation --locale es --status Open --min-reward 0.1
gitsettle list --status Expired --json
gitsettle show 8
gitsettle profile contributor.gitsettle-ac1b0f23f4.testnet
gitsettle leaderboard --json
```

`list` supports `Bug`, `Feature`, `Audit`, `Translation`, and `Other`, locale,
minimum reward, and stored statuses plus the derived `Expired` status. Matching
is case-insensitive for type/status/locale options. Expired Open/Claimed/Rejected
work is shown by the `Expired` filter; timely submitted work stays `Submitted`
after its deadline. Reward comparison uses exact integer yoctoNEAR arithmetic.

All ordinary reads use finalized RPC state. `--api` or `GITSETTLE_API_URL` can
instead read the self-hosted site's public endpoints:

```sh
gitsettle list --api https://gitsettle.89.167.109.196.sslip.io --json
```

An API source must advertise testnet mode and the selected contract. It may have
the site's normal short cache or outage behavior. API errors are surfaced; the
CLI does not silently replace live data with examples. API requests have a
15-second timeout and a two-megabyte streamed response limit. Endpoints require
HTTPS except for HTTP loopback development URLs; URL credentials, query strings,
fragments, and redirects are rejected. **Changes always use finalized RPC**,
even when `--api` is supplied. API responses cannot select a signing key,
transaction recipient, method, or deposit.

## Signing credentials

Private keys are accepted only through the environment or a wallet file. There
is no command-line private-key flag, no automatic `.env` loading, and no reuse
of a server verifier key. CLI output never includes the credential object.
Use a funded testnet account, separate from mainnet funds.

On a POSIX system, an existing wallet JSON file must be a regular non-symlink
file owned by the current user, with permissions **0600** and size at most 16 KiB:

```sh
chmod 600 /secure/alice.testnet.json
gitsettle claim 0 --wallet /secure/alice.testnet.json --dry-run
```

Supported JSON shapes are `{ "accountId": "alice.testnet", "privateKey": "..." }`
and the NEAR CLI shape `{ "account_id": "alice.testnet", "private_key": "..." }`.
The key must be a valid Ed25519 key. This documentation intentionally includes
no usable key. If `--account` is also supplied, it must match the file account.
`GITSETTLE_WALLET_FILE` is the environment alternative to `--wallet`.

For a temporary Bash session, read a key without putting it in shell history:

```sh
export GITSETTLE_ACCOUNT_ID=alice.testnet
read -rsp 'Testnet private key: ' GITSETTLE_PRIVATE_KEY
export GITSETTLE_PRIVATE_KEY
```

Run the desired command, then `unset GITSETTLE_PRIVATE_KEY` when finished.
The OS account, process environment, and wallet file remain trusted local
boundaries. Never commit a wallet file or print a private key into logs.

## Post → claim → submit → payout

Every change **stops at a transaction preview unless `--yes` is present**.
`--dry-run` always wins over `--yes` and never even loads the signing credential.
The preview includes contract, selected account if known, method, arguments,
attached yoctoNEAR, gas, and relevant warnings. This makes scripts predictable
without an interactive prompt.

The following create command is a safe preview against a real existing issue;
it does not post another bounty. For actual funding, choose a fresh issue that
needs work, a future deadline, and your intended reward before adding `--yes`:

```sh
gitsettle create \
  --repo CodeMasterLabs/gitsettle \
  --issue https://github.com/CodeMasterLabs/gitsettle/issues/9 \
  --type Translation --locale es \
  --reward 0.05 --deadline 2026-11-20T23:59:00Z \
  --account alice.testnet --dry-run
```

`post` is an alias for `create`. Deadlines accept future Unix **seconds** or an
exact UTC `YYYY-MM-DDTHH:mm:ssZ` value within 366 days. Reward decimals have up to
24 places and must be positive and at most 1,000,000 NEAR. Translation requires
a locale; other work types reject one. The issue and PR URLs must exactly match
the stored repository's spelling and use canonical HTTPS GitHub paths.

The CLI reads `get_config` to attach **reward + the current storage reserve**.
The deployed reserve is 0.05 NEAR; a 0.05 NEAR reward currently attaches 0.10 NEAR.
The reserve is nonrefundable, and transaction gas is additional. The CLI checks
the finalized bounty list with the same canonical issue/type/locale
matching rules as the web preflight. Create previews include
`transaction.duplicateBountyIds` and a warning for active matches. Actual funding
with `--yes` is blocked until you also add **`--allow-duplicate`** to explicitly
authorize intentional additional funding. This flag is valid only for
`create`/`post`; it never authorizes signing by itself, and `--dry-run` still wins.
Failed or malformed duplicate data stops funding even with the flag. The check
is repeated after loading the signer, but it is not an atomic on-chain uniqueness
constraint: another account can still fund matching work after the final check.
Expired unsubmitted work and settled bounties do not match; submitted work remains
protected and is included after its deadline. Spam-text/AI triage and private
support remain web features.

After a real create succeeds, use its returned bounty ID. The claimant must be
a different account from the poster. Replace `NEW_ID` and `PR_URL` below with
your actual new bounty and pull request:

```sh
gitsettle claim NEW_ID --wallet /secure/contributor.testnet.json --dry-run
gitsettle claim NEW_ID --wallet /secure/contributor.testnet.json --yes
gitsettle submit NEW_ID --pr PR_URL --wallet /secure/contributor.testnet.json --dry-run
gitsettle submit NEW_ID --pr PR_URL --wallet /secure/contributor.testnet.json --yes
```

The submit preview prints the required PR-body marker:

```text
GitSettle: gitsettle-ac1b0f23f4.testnet/NEW_ID/contributor.testnet
```

The PR must also reference the issue with a supported closing phrase and, for a
translation, change files in the requested locale path. After merge, the trusted
verifier and AgentGuard perform the documented automatic-release checks. The CLI
does not create or merge GitHub PRs. Inspect progress with `show`, `profile`, and
`leaderboard`.

An authorized poster or verifier can explicitly release submitted work. A poster
can refund an expired Open/Claimed/Rejected bounty; Submitted work is protected:

```sh
gitsettle release NEW_ID --wallet /secure/poster.testnet.json --dry-run
gitsettle release NEW_ID --wallet /secure/poster.testnet.json --yes
gitsettle refund EXPIRED_ID --wallet /secure/poster.testnet.json --dry-run
gitsettle refund EXPIRED_ID --wallet /secure/poster.testnet.json --yes
```

A direct authorized release bypasses the automatic verifier/AgentGuard path and
requires the caller to review the evidence. It does not bypass the contract's
account/state checks. Local access/state checks are repeated for the loaded
signer before submission; the contract remains authoritative if state changes.

## Results, failures, and automation

Use `--json` for one structured stdout result. Amount fields remain decimal
yoctoNEAR strings. Previews return `status: "preview"`; submitted operations
return the transaction hash, explorer URL, confirmation status, and latest bounty
when available. Errors are safe `{ "error": { "code", "message" } }` objects on
stderr. Unstructured SDK/provider errors and credentials are never printed.

Transactions request `FINAL`, verify signer/receiver/method/arguments and the
contract return value, and read final bounty state. A release/refund callback
returning `false` is a failed payment. A hash by itself is never reported as a
confirmed payout. If a post-submission view fails, the hash is retained with
`pending`; check it before retrying. A transport failure can be ambiguous, so
check the account transaction history and bounty rather than blindly submitting
the same operation again.

| Exit code | Meaning |
| --- | --- |
| `0` | Read succeeded, preview completed, or transaction confirmed |
| `1` | Request/access/credential error or confirmed failed transaction |
| `2` | Invalid arguments |
| `3` | Submitted transaction needs further confirmation |

## Validation and implementation map

```sh
npm run test --workspace @gitsettle/cli
npm run typecheck --workspace @gitsettle/cli
npm pack --dry-run --json --workspace @gitsettle/cli
```

The focused suite has 25 tests for strict argument/URL/date/locale validation,
exact amounts and filtering, credential permissions and redaction, API limits,
all five fake-port mutation paths, access denial, preview/`--yes` behavior,
failed transfer callbacks, and ambiguous submission recovery. Package dry-run
confirmed that the executable launcher is included with mode 0755.

Read-only live validation on November 14, 2026 read nine real bounties, selected
bounty 0 with the Spanish/open/minimum-reward filters, read bounty 8 as Released,
and showed the paid contributor at 100 points, one merge, and 0.05 NEAR earned.
The leaderboard returned that contributor, and `claim 0 --dry-run` produced a
zero-deposit preview without signing. The optional API correctly surfaced a
503 during a public board outage; direct finalized RPC reads continued to work.
The public API also passed after the RPC provider update; read-only evidence is in [CLI_E2E.json](CLI_E2E.json).
The new CLI has **not** sent a live transaction during this checkpoint; its
signed lifecycle paths were exercised through injected fake transaction ports.

Files: `args.ts` validates input; `credentials.ts` is the only local secret reader;
`client.ts` implements RPC/API transports; `commands.ts` plans and executes the
lifecycle; `output.ts` handles JSON/tabular display and terminal escaping;
`index.ts` is the safe process boundary. Exact API calls were checked against the
installed **near-api-js 7.5.3** declarations and the previously verified sources
in [API_SOURCES.md](API_SOURCES.md). The `tsx` launcher uses the installed
**4.23.15** ESM API. No library version or argument shape is inferred from an
older SDK example.
