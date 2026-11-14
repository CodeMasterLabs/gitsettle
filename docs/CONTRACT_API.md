# GitSettle contract API

All calls use JSON. `id`, `deadline`, and other timestamps are JSON numbers;
timestamps are **Unix seconds**, not JavaScript milliseconds or NEAR nanoseconds.
Balances (`reward`, `total_earned`, `storage_reserve`) are decimal **strings of
yoctoNEAR**. One NEAR is `1000000000000000000000000` yoctoNEAR.

## Initialization

`new({"verifier":"<verifier testnet account>"})`, once, in the same atomic
transaction as deployment. The predecessor must be the contract's account.
The verifier is immutable in this MVP; use a new contract deployment to change it.

## Change methods

| Method | Arguments | Access / attached deposit | Return |
| --- | --- | --- | --- |
| `create_bounty` | `{repo, issue_url, bounty_type, target_locale, reward, deadline}` | Any account; **exactly reward + storage reserve** | Bounty |
| `claim_bounty` | `{id}` | Any account except poster, before deadline; zero deposit | Bounty |
| `submit_pr` | `{id, pr_url}` | Claimant, Claimed or Rejected, before deadline; zero deposit | Bounty |
| `reject_submission` | `{id, reason}` | Verifier, Submitted only; zero deposit | Bounty |
| `release` | `{id}` | Verifier or poster, Submitted only; zero deposit, at least 60 Tgas | Promise resolving to callback boolean |
| `refund` | `{id}` | Poster, deadline reached, Open/Claimed/Rejected only; zero deposit, at least 60 Tgas | Promise resolving to callback boolean |
| `on_release` | `{id}` | Private receipt callback only | Boolean |
| `on_refund` | `{id}` | Private receipt callback only | Boolean |

Use 100 Tgas for ordinary wallet changes and settlement. The minimum for settlement
reserves a 30 Tgas callback. A transaction containing a successful transfer callback
returns `true`; transfer failure returns `false` and restores the pre-transfer state.
Always read the final bounty status after a change. An accepted transaction hash
alone does not prove payment.

Example create arguments (example only; choose a future deadline):

```json
{
  "repo": "CodeMasterLabs/gitsettle",
  "issue_url": "https://github.com/CodeMasterLabs/gitsettle/issues/17",
  "bounty_type": "Translation",
  "target_locale": "es",
  "reward": "2000000000000000000000000",
  "deadline": 1794787140
}
```

For a 2 NEAR reward the attached deposit is 2.05 NEAR. The 0.05 NEAR storage
reserve is retained permanently and is never paid to the claimant or refunded.
Read `get_config` instead of hardcoding this charge in a client.

Constraints: reward greater than zero and at most 1,000,000 NEAR; deadline in the
future and within 366 days; `repo` up to 140 ASCII bytes in `owner/name` form;
canonical issue and PR URLs up to 200 bytes with a positive decimal number up to
16 digits; rejection reason 1–300 bytes; translation locale 2–16 lowercase ASCII
letters/digits with nonempty hyphen-separated parts, such as `es`, `bn`, `ja`, or
`pt-br`. Non-translation bounties require `target_locale: null`.

## Read methods

| Method | Arguments | Result |
| --- | --- | --- |
| `get_bounty` | `{id}` | Bounty or null |
| `list_bounties` | `{from_index?: number, limit?: number}` | Bounty[] in ID order; default 50, max 100 |
| `get_bounty_count` | `{}` | Number of allocated IDs |
| `get_profile` | `{account_id}` | Contributor, zeroed if unknown |
| `get_leaderboard` | `{from_index?: number, limit?: number}` | Contributor[]; pages of the materialized top 100, default page 50 |
| `get_config` | `{}` | Config |

Pagination indices are zero based. Bounty IDs are contiguous, start at zero and
are never removed. Pass `from_index = previous + results.length` until a page is
empty or the count is reached. The top 100 contributors are ordered by descending
points, then ascending account ID as a deterministic tie break. Every account's
statistics remain available with `get_profile` even outside the top 100.

```ts
type BountyType = "Bug" | "Feature" | "Audit" | "Translation" | "Other";
type BountyStatus = "Open" | "Claimed" | "Submitted" | "Rejected"
  | "Releasing" | "Released" | "Refunding" | "Refunded";
type Bounty = {
  id: number;
  poster: string;
  repo: string;
  issue_url: string;
  bounty_type: BountyType;
  target_locale: string | null;
  reward: string;
  deadline: number;
  status: BountyStatus;
  claimant: string | null;
  pr_url: string | null;
  created_at: number;
  submitted_at: number | null;
  settled_at: number | null;
  rejection_reason: string | null;
};
type Contributor = {
  account_id: string;
  points: number;
  merged_count: number;
  total_earned: string;
};
type Config = {
  verifier: string;
  storage_reserve: string;
  bounty_count: number;
  points_per_merge: number; // 100
  leaderboard_limit: number; // 100
};
```

Expired is a client-derived display state (`now >= deadline` on Open/Claimed/
Rejected). It is not a stored contract status. Submitted bounties remain pending
verification after the deadline and may be paid later.

## Oracle evidence binding

The verifier must find an exact line in the PR body:

```text
GitSettle: <contract-account>/<bounty-id>/<claimant-account>
```

The PR author controls this body. This prevents a different claimant from simply
submitting somebody else's merged PR. The contract itself validates URL shape
and claimant authorization, while the verifier validates this binding, merge,
target repository, issue reference, and (for translations) locale changes.

## Events

Mutations emit NEP-297-style `EVENT_JSON:` records using standard `gitsettle`,
version `1.0.0`, an event name, and `data: [{id, status, reward}]`.
Events: `bounty_created`, `bounty_claimed`, `pr_submitted`, `submission_rejected`,
`release_started`, `release_failed`, `reward_released`, `refund_started`,
`refund_failed`, and `reward_refunded`. Reconcile events against finalized state.
