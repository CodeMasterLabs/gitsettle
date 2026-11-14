//! Native NEAR escrow for GitHub contributions.
//!
//! GitHub is not visible to a NEAR contract. A fixed, trusted verifier checks
//! off-chain evidence; the poster may also authorize payment. Only a successful
//! transfer callback awards reputation. See `docs/CONTRACT.md` for the trust model.

use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{AccountId, Gas, NearToken, PanicOnDefault, Promise, env, near, require};

/// Kept by the contract to cover bounded bounty, account and leaderboard storage.
pub const STORAGE_RESERVE: u128 = 50_000_000_000_000_000_000_000;
const MAX_REWARD: u128 = 1_000_000 * 10u128.pow(24);
const POINTS_PER_MERGE: u64 = 100;
const LEADERBOARD_SIZE: usize = 100;
const CALLBACK_GAS: Gas = Gas::from_tgas(30);
const MIN_SETTLEMENT_GAS: Gas = Gas::from_tgas(60);
const MAX_DEADLINE_SECONDS: u64 = 366 * 24 * 60 * 60;

/// A bounty category. Translation requires a normalized locale such as `es`.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BountyType {
    Bug,
    Feature,
    Audit,
    Translation,
    Other,
}

/// Pending settlement states prevent a second transfer while a receipt executes.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BountyStatus {
    Open,
    Claimed,
    Submitted,
    Rejected,
    Releasing,
    Released,
    Refunding,
    Refunded,
}

/// Public bounty representation; times are Unix seconds, balances are yoctoNEAR.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Bounty {
    pub id: u64,
    pub poster: AccountId,
    pub repo: String,
    pub issue_url: String,
    pub bounty_type: BountyType,
    pub target_locale: Option<String>,
    pub reward: U128,
    pub deadline: u64,
    pub status: BountyStatus,
    pub claimant: Option<AccountId>,
    pub pr_url: Option<String>,
    pub created_at: u64,
    pub submitted_at: Option<u64>,
    pub settled_at: Option<u64>,
    pub rejection_reason: Option<String>,
}

/// Reputation reflects completed transfers, not submissions or pending receipts.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Contributor {
    pub account_id: AccountId,
    pub points: u64,
    pub merged_count: u64,
    pub total_earned: U128,
}

/// Frontends obtain the storage charge and trusted account from the contract.
#[near(serializers = [json])]
pub struct Config {
    pub verifier: AccountId,
    pub storage_reserve: U128,
    pub bounty_count: u64,
    pub points_per_merge: u64,
    pub leaderboard_limit: u64,
}

/// Immutable verifier, persistent escrows and a bounded top-100 leaderboard.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct GitSettle {
    verifier: AccountId,
    bounty_count: u64,
    bounties: LookupMap<u64, Bounty>,
    contributors: IterableMap<AccountId, Contributor>,
    leaders: Vec<Contributor>,
}

#[near]
impl GitSettle {
    /// Initialize in the deploy-and-initialize transaction, signed by this account.
    #[init]
    pub fn new(verifier: AccountId) -> Self {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Only the contract account can initialize"
        );
        require!(!env::state_exists(), "Already initialized");
        Self {
            verifier,
            bounty_count: 0,
            bounties: LookupMap::new(b"b"),
            contributors: IterableMap::new(b"c"),
            leaders: Vec::new(),
        }
    }

    /// Lock exactly `reward + storage_reserve` yoctoNEAR in a new bounty.
    ///
    /// A fixed charge makes wallet previews deterministic and pays for the entire
    /// bounded record lifecycle, including a new contributor's reputation entry.
    /// This charge is nonrefundable; it is never included in the reward transfer.
    #[payable]
    pub fn create_bounty(
        &mut self,
        repo: String,
        issue_url: String,
        bounty_type: BountyType,
        target_locale: Option<String>,
        reward: U128,
        deadline: u64,
    ) -> Bounty {
        validate_repo(&repo);
        validate_github_url(&issue_url, &repo, "issues");
        require!(
            reward.0 > 0 && reward.0 <= MAX_REWARD,
            "Reward must be positive and at most 1000000 NEAR"
        );
        require!(deadline > now(), "Deadline must be in the future");
        require!(
            deadline.saturating_sub(now()) <= MAX_DEADLINE_SECONDS,
            "Deadline must be within 366 days"
        );
        match bounty_type {
            BountyType::Translation => {
                let locale = target_locale.as_deref().unwrap_or("");
                require!(
                    valid_locale(locale),
                    "Translation requires a lowercase locale, e.g. es or pt-br"
                );
            }
            _ => require!(
                target_locale.is_none(),
                "Only translation bounties have a target locale"
            ),
        }
        require!(
            env::attached_deposit().as_yoctonear() == reward.0 + STORAGE_RESERVE,
            "Attach exactly reward plus storage reserve"
        );
        let id = self.bounty_count;
        self.bounty_count = self
            .bounty_count
            .checked_add(1)
            .expect("Bounty limit reached");
        let bounty = Bounty {
            id,
            poster: env::predecessor_account_id(),
            repo,
            issue_url,
            bounty_type,
            target_locale,
            reward,
            deadline,
            status: BountyStatus::Open,
            claimant: None,
            pr_url: None,
            created_at: now(),
            submitted_at: None,
            settled_at: None,
            rejection_reason: None,
        };
        self.bounties.insert(id, bounty.clone());
        emit("bounty_created", &bounty);
        bounty
    }

    /// Reserve an open bounty for the calling account before its deadline.
    pub fn claim_bounty(&mut self, id: u64) -> Bounty {
        assert_no_deposit();
        let mut bounty = self.bounty(id);
        require!(bounty.status == BountyStatus::Open, "Bounty is not open");
        require!(now() < bounty.deadline, "Bounty has expired");
        require!(
            env::predecessor_account_id() != bounty.poster,
            "Poster cannot claim their own bounty"
        );
        bounty.claimant = Some(env::predecessor_account_id());
        bounty.status = BountyStatus::Claimed;
        self.save("bounty_claimed", bounty)
    }

    /// Submit a PR from the bounty repository; only the claimant may submit.
    ///
    /// A rejected submission can be corrected before the original deadline. The
    /// verifier checks author-controlled account binding and issue/locale evidence.
    pub fn submit_pr(&mut self, id: u64, pr_url: String) -> Bounty {
        assert_no_deposit();
        let mut bounty = self.bounty(id);
        require!(
            bounty.claimant.as_ref() == Some(&env::predecessor_account_id()),
            "Only the claimant can submit"
        );
        require!(
            matches!(
                bounty.status,
                BountyStatus::Claimed | BountyStatus::Rejected
            ),
            "Bounty does not accept a submission"
        );
        require!(now() < bounty.deadline, "Submission deadline has passed");
        validate_github_url(&pr_url, &bounty.repo, "pull");
        bounty.pr_url = Some(pr_url);
        bounty.status = BountyStatus::Submitted;
        bounty.submitted_at = Some(now());
        bounty.rejection_reason = None;
        self.save("pr_submitted", bounty)
    }

    /// Reject invalid evidence; only the configured oracle can unlock this path.
    ///
    /// Network failures and not-yet-merged PRs are not evidence of invalidity. The
    /// worker must leave those submitted until it can make a definitive decision.
    pub fn reject_submission(&mut self, id: u64, reason: String) -> Bounty {
        assert_no_deposit();
        require!(
            env::predecessor_account_id() == self.verifier,
            "Only the verifier can reject a submission"
        );
        let mut bounty = self.bounty(id);
        require!(
            bounty.status == BountyStatus::Submitted,
            "Bounty is not submitted"
        );
        require!(
            !reason.trim().is_empty() && reason.len() <= 300,
            "Reason must contain 1 to 300 bytes"
        );
        bounty.status = BountyStatus::Rejected;
        bounty.rejection_reason = Some(reason);
        self.save("submission_rejected", bounty)
    }

    /// Authorize reward transfer after trusted verification or poster review.
    ///
    /// The poster is an explicit trust path, so this function cannot prove a merge.
    /// State is changed before scheduling a transfer and finalized in its callback.
    pub fn release(&mut self, id: u64) -> Promise {
        assert_no_deposit();
        let mut bounty = self.bounty(id);
        let caller = env::predecessor_account_id();
        require!(
            caller == self.verifier || caller == bounty.poster,
            "Only the verifier or poster can release"
        );
        require!(
            bounty.status == BountyStatus::Submitted,
            "Bounty is not submitted"
        );
        require!(
            env::prepaid_gas() >= MIN_SETTLEMENT_GAS,
            "Attach at least 60 Tgas for settlement"
        );
        let claimant = bounty
            .claimant
            .clone()
            .expect("Submitted bounty requires claimant");
        bounty.status = BountyStatus::Releasing;
        let reward = bounty.reward.0;
        self.save("release_started", bounty);
        Promise::new(claimant)
            .transfer(NearToken::from_yoctonear(reward))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_release(id),
            )
    }

    /// Return expired escrow to its poster only when there is no pending evidence.
    ///
    /// Submitted bounties stay locked until the oracle accepts or rejects the PR.
    /// This avoids racing a delayed payout worker after a legitimate submission.
    pub fn refund(&mut self, id: u64) -> Promise {
        assert_no_deposit();
        let mut bounty = self.bounty(id);
        require!(
            env::predecessor_account_id() == bounty.poster,
            "Only the poster can refund"
        );
        require!(
            now() >= bounty.deadline,
            "Refund is available after the deadline"
        );
        require!(
            matches!(
                bounty.status,
                BountyStatus::Open | BountyStatus::Claimed | BountyStatus::Rejected
            ),
            "Bounty has a submission or is already settled"
        );
        require!(
            env::prepaid_gas() >= MIN_SETTLEMENT_GAS,
            "Attach at least 60 Tgas for settlement"
        );
        bounty.status = BountyStatus::Refunding;
        let poster = bounty.poster.clone();
        let reward = bounty.reward.0;
        self.save("refund_started", bounty);
        Promise::new(poster)
            .transfer(NearToken::from_yoctonear(reward))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_refund(id),
            )
    }

    /// Private transfer callback. A failure restores Submitted so payment can retry.
    #[private]
    pub fn on_release(&mut self, id: u64) -> bool {
        assert_callback();
        let mut bounty = self.bounty(id);
        require!(
            bounty.status == BountyStatus::Releasing,
            "No release is pending"
        );
        // Transfers return no data. A zero-byte bound also avoids an unbounded read.
        let succeeded = env::promise_result_checked(0, 0).is_ok();
        if succeeded {
            bounty.status = BountyStatus::Released;
            bounty.settled_at = Some(now());
            // These invariants were established before scheduling the transfer.
            // Saturating counters avoid making a successful payout unfinalizable.
            if let Some(account_id) = bounty.claimant.clone() {
                let mut contributor = self.profile(&account_id);
                contributor.points = contributor.points.saturating_add(POINTS_PER_MERGE);
                contributor.merged_count = contributor.merged_count.saturating_add(1);
                contributor.total_earned =
                    U128(contributor.total_earned.0.saturating_add(bounty.reward.0));
                self.contributors.insert(account_id, contributor.clone());
                self.update_leaders(contributor);
            }
            self.save("reward_released", bounty);
        } else {
            bounty.status = BountyStatus::Submitted;
            self.save("release_failed", bounty);
        }
        succeeded
    }

    /// Private refund callback. Failed transfers restore the exact refundable state.
    #[private]
    pub fn on_refund(&mut self, id: u64) -> bool {
        assert_callback();
        let mut bounty = self.bounty(id);
        require!(
            bounty.status == BountyStatus::Refunding,
            "No refund is pending"
        );
        let succeeded = env::promise_result_checked(0, 0).is_ok();
        if succeeded {
            bounty.status = BountyStatus::Refunded;
            bounty.settled_at = Some(now());
            self.save("reward_refunded", bounty);
        } else {
            bounty.status = if bounty.pr_url.is_some() {
                BountyStatus::Rejected
            } else if bounty.claimant.is_some() {
                BountyStatus::Claimed
            } else {
                BountyStatus::Open
            };
            self.save("refund_failed", bounty);
        }
        succeeded
    }

    /// Read one bounty without panicking when its ID has not been allocated.
    pub fn get_bounty(&self, id: u64) -> Option<Bounty> {
        self.bounties.get(&id).cloned()
    }

    /// Read an ID-ordered page, with a default of 50 and a maximum of 100 records.
    pub fn list_bounties(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<Bounty> {
        let start = from_index.unwrap_or(0).min(self.bounty_count);
        let count = limit.unwrap_or(50).min(100);
        (start..start.saturating_add(count).min(self.bounty_count))
            .filter_map(|id| self.bounties.get(&id).cloned())
            .collect()
    }

    /// Number of allocated bounty IDs; IDs are contiguous and records never deleted.
    pub fn get_bounty_count(&self) -> u64 {
        self.bounty_count
    }

    /// Return zeroed statistics for an account that has not earned a reward yet.
    pub fn get_profile(&self, account_id: AccountId) -> Contributor {
        self.profile(&account_id)
    }

    /// Read a page of the leading 100 contributors, ordered by points then account.
    ///
    /// A materialized, bounded list avoids scanning all contributors in a view call.
    /// Every account's complete statistics remain available through `get_profile`.
    pub fn get_leaderboard(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<Contributor> {
        self.leaders
            .iter()
            .skip(from_index.unwrap_or(0).min(LEADERBOARD_SIZE as u64) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .cloned()
            .collect()
    }

    /// Return immutable configuration for wallet previews and oracle configuration.
    pub fn get_config(&self) -> Config {
        Config {
            verifier: self.verifier.clone(),
            storage_reserve: U128(STORAGE_RESERVE),
            bounty_count: self.bounty_count,
            points_per_merge: POINTS_PER_MERGE,
            leaderboard_limit: LEADERBOARD_SIZE as u64,
        }
    }
}

impl GitSettle {
    fn bounty(&self, id: u64) -> Bounty {
        self.bounties.get(&id).cloned().expect("Bounty not found")
    }

    fn save(&mut self, event: &str, bounty: Bounty) -> Bounty {
        self.bounties.insert(bounty.id, bounty.clone());
        emit(event, &bounty);
        bounty
    }

    fn profile(&self, account_id: &AccountId) -> Contributor {
        self.contributors
            .get(account_id)
            .cloned()
            .unwrap_or_else(|| Contributor {
                account_id: account_id.clone(),
                points: 0,
                merged_count: 0,
                total_earned: U128(0),
            })
    }

    fn update_leaders(&mut self, contributor: Contributor) {
        self.leaders
            .retain(|entry| entry.account_id != contributor.account_id);
        self.leaders.push(contributor);
        self.leaders.sort_by(|a, b| {
            b.points
                .cmp(&a.points)
                .then_with(|| a.account_id.cmp(&b.account_id))
        });
        self.leaders.truncate(LEADERBOARD_SIZE);
    }
}

fn now() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

fn assert_no_deposit() {
    require!(
        env::attached_deposit().is_zero(),
        "This method does not accept deposits"
    );
}

fn assert_callback() {
    assert_no_deposit();
    require!(
        env::predecessor_account_id() == env::current_account_id(),
        "Callback is private"
    );
    require!(
        env::promise_results_count() == 1,
        "Callback requires one transfer result"
    );
}

fn validate_repo(repo: &str) {
    require!(repo.len() <= 140, "Repository is too long");
    let parts: Vec<_> = repo.split('/').collect();
    require!(parts.len() == 2, "Repository must be owner/name");
    require!(
        parts.iter().all(|part| !part.is_empty()
            && *part != "."
            && *part != ".."
            && part
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))),
        "Invalid repository name"
    );
}

fn validate_github_url(url: &str, repo: &str, kind: &str) {
    require!(url.len() <= 200, "GitHub URL is too long");
    let prefix = format!("https://github.com/{repo}/{kind}/");
    let number = url.strip_prefix(&prefix).unwrap_or("");
    require!(
        !number.is_empty()
            && number.len() <= 16
            && !number.starts_with('0')
            && number.bytes().all(|c| c.is_ascii_digit()),
        "Use a canonical GitHub URL from the bounty repository"
    );
}

fn valid_locale(locale: &str) -> bool {
    (2..=16).contains(&locale.len())
        && locale.split('-').all(|part| {
            !part.is_empty()
                && part.len() <= 8
                && part
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        })
        && locale.as_bytes()[..2].iter().all(u8::is_ascii_lowercase)
}

fn emit(event: &str, bounty: &Bounty) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        near_sdk::serde_json::json!({
            "standard": "gitsettle", "version": "1.0.0", "event": event,
            "data": [{"id": bounty.id, "status": bounty.status, "reward": bounty.reward}]
        })
    ));
}

#[cfg(test)]
mod tests;
