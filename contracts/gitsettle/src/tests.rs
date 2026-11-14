//! State-machine tests use the SDK's mocked host. They inspect scheduled receipts
//! as well as state, and supply success/failure results for the private callbacks.
use super::*;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts};
use near_sdk::{PromiseResult, RuntimeFeesConfig, test_vm_config, testing_env};
use std::collections::HashMap;
use std::panic::{AssertUnwindSafe, catch_unwind};

const START: u64 = 1_800_000_000;
const DEADLINE: u64 = START + 3_600;
const REWARD: u128 = 2 * 10u128.pow(24);
const CONTRACT: &str = "gitsettle.testnet";
const POSTER: &str = "poster.testnet";
const CLAIMANT: &str = "contributor.testnet";
const VERIFIER: &str = "verifier.testnet";
const OUTSIDER: &str = "outsider.testnet";
const REPO: &str = "CodeMasterLabs/gitsettle";
const ISSUE: &str = "https://github.com/CodeMasterLabs/gitsettle/issues/17";
const PR: &str = "https://github.com/CodeMasterLabs/gitsettle/pull/23";
const ALL_STATUSES: [BountyStatus; 8] = [
    BountyStatus::Open,
    BountyStatus::Claimed,
    BountyStatus::Submitted,
    BountyStatus::Rejected,
    BountyStatus::Releasing,
    BountyStatus::Released,
    BountyStatus::Refunding,
    BountyStatus::Refunded,
];

fn account(value: &str) -> AccountId {
    value.parse().unwrap()
}

fn builder(caller: &str, deposit: u128, timestamp: u64) -> VMContextBuilder {
    let storage = env::storage_usage();
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id(account(CONTRACT))
        .signer_account_id(account(caller))
        .predecessor_account_id(account(caller))
        .block_timestamp(timestamp * 1_000_000_000)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .account_balance(NearToken::from_near(1_000_000_000))
        .storage_usage(storage)
        .prepaid_gas(Gas::from_tgas(300));
    builder
}

fn context(caller: &str, deposit: u128, timestamp: u64) {
    testing_env!(builder(caller, deposit, timestamp).build());
}

fn callback(caller: &str, success: bool) {
    let result = if success {
        PromiseResult::Successful(vec![])
    } else {
        PromiseResult::Failed
    };
    testing_env!(
        builder(caller, 0, DEADLINE + 1).build(),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        HashMap::default(),
        vec![result]
    );
}

fn fresh() -> GitSettle {
    // A matrix test may create more than one independent contract in one thread.
    near_sdk::mock::with_mocked_blockchain(|blockchain| {
        blockchain.take_storage();
    });
    let mut initial = builder(CONTRACT, 0, START);
    initial.storage_usage(0);
    testing_env!(initial.build());
    GitSettle::new(account(VERIFIER))
}

fn create(contract: &mut GitSettle) -> Bounty {
    context(POSTER, REWARD + STORAGE_RESERVE, START);
    contract.create_bounty(
        REPO.into(),
        ISSUE.into(),
        BountyType::Bug,
        None,
        U128(REWARD),
        DEADLINE,
    )
}

fn claimed() -> GitSettle {
    let mut contract = fresh();
    create(&mut contract);
    context(CLAIMANT, 0, START + 1);
    contract.claim_bounty(0);
    contract
}

fn submitted() -> GitSettle {
    let mut contract = claimed();
    context(CLAIMANT, 0, START + 2);
    contract.submit_pr(0, PR.into());
    contract
}

fn assert_panics(action: impl FnOnce()) {
    assert!(
        catch_unwind(AssertUnwindSafe(action)).is_err(),
        "Expected access/state validation failure"
    );
}

fn set_status(contract: &mut GitSettle, status: BountyStatus) {
    let mut bounty = contract.bounty(0);
    bounty.status = status;
    contract.bounties.insert(0, bounty);
}

fn flush(contract: &mut GitSettle) {
    contract.bounties.flush();
    contract.contributors.flush();
    env::state_write(contract);
}

#[test]
fn initialization_requires_contract_account() {
    context(OUTSIDER, 0, START);
    assert_panics(|| {
        GitSettle::new(account(VERIFIER));
    });
}

#[test]
fn initialization_cannot_replace_state() {
    let contract = fresh();
    env::state_write(&contract);
    assert_panics(|| {
        GitSettle::new(account(OUTSIDER));
    });
}

#[test]
fn empty_views_and_configuration_are_explicit() {
    let contract = fresh();
    assert!(contract.get_bounty(0).is_none());
    assert!(contract.list_bounties(None, None).is_empty());
    assert!(contract.get_leaderboard(None, None).is_empty());
    assert_eq!(contract.get_bounty_count(), 0);
    let profile = contract.get_profile(account(CLAIMANT));
    assert_eq!(
        (profile.points, profile.merged_count, profile.total_earned.0),
        (0, 0, 0)
    );
    let config = contract.get_config();
    assert_eq!(config.verifier, account(VERIFIER));
    assert_eq!(config.storage_reserve.0, STORAGE_RESERVE);
    assert_eq!(config.leaderboard_limit, 100);
}

#[test]
fn creates_each_type_and_records_exact_escrow() {
    let mut contract = fresh();
    for (index, bounty_type) in [
        BountyType::Bug,
        BountyType::Feature,
        BountyType::Audit,
        BountyType::Translation,
        BountyType::Other,
    ]
    .into_iter()
    .enumerate()
    {
        context(POSTER, REWARD + STORAGE_RESERVE, START);
        let locale = (bounty_type == BountyType::Translation).then(|| "bn".to_owned());
        let bounty = contract.create_bounty(
            REPO.into(),
            ISSUE.into(),
            bounty_type,
            locale.clone(),
            U128(REWARD),
            DEADLINE,
        );
        assert_eq!(bounty.id, index as u64);
        assert_eq!(bounty.status, BountyStatus::Open);
        assert_eq!(bounty.reward.0, REWARD);
        assert_eq!(bounty.target_locale, locale);
        assert_eq!(bounty.poster, account(POSTER));
        assert_eq!(bounty.created_at, START);
    }
    assert_eq!(contract.get_bounty_count(), 5);
    assert!(
        get_created_receipts().is_empty(),
        "Creation must retain full deposit"
    );
}

#[test]
fn rejects_missing_excess_and_insufficient_deposits() {
    let mut contract = fresh();
    for deposit in [
        0,
        REWARD,
        REWARD + STORAGE_RESERVE - 1,
        REWARD + STORAGE_RESERVE + 1,
    ] {
        context(POSTER, deposit, START);
        assert_panics(|| {
            contract.create_bounty(
                REPO.into(),
                ISSUE.into(),
                BountyType::Bug,
                None,
                U128(REWARD),
                DEADLINE,
            );
        });
        assert_eq!(contract.get_bounty_count(), 0);
    }
}

#[test]
fn rejects_zero_and_unbounded_rewards() {
    let mut contract = fresh();
    for reward in [0, MAX_REWARD + 1, u128::MAX] {
        context(POSTER, STORAGE_RESERVE, START);
        assert_panics(|| {
            contract.create_bounty(
                REPO.into(),
                ISSUE.into(),
                BountyType::Bug,
                None,
                U128(reward),
                DEADLINE,
            );
        });
    }
}

#[test]
fn rejects_past_and_unreasonably_distant_deadlines() {
    let mut contract = fresh();
    for deadline in [0, START, START + MAX_DEADLINE_SECONDS + 1, u64::MAX] {
        context(POSTER, REWARD + STORAGE_RESERVE, START);
        assert_panics(|| {
            contract.create_bounty(
                REPO.into(),
                ISSUE.into(),
                BountyType::Bug,
                None,
                U128(REWARD),
                deadline,
            );
        });
    }
}

#[test]
fn repositories_and_issue_urls_are_canonical() {
    let mut contract = fresh();
    for repo in [
        "",
        "gitsettle",
        "a/b/c",
        "../name",
        "owner/..",
        "owner/my repo",
        "owner/repo?x=1",
    ] {
        context(POSTER, REWARD + STORAGE_RESERVE, START);
        assert_panics(|| {
            contract.create_bounty(
                repo.into(),
                ISSUE.into(),
                BountyType::Bug,
                None,
                U128(REWARD),
                DEADLINE,
            );
        });
    }
    for url in [
        "https://example.com/CodeMasterLabs/gitsettle/issues/17",
        "https://github.com/other/gitsettle/issues/17",
        "https://github.com/CodeMasterLabs/gitsettle/pull/17",
        "https://github.com/CodeMasterLabs/gitsettle/issues/017",
        "https://github.com/CodeMasterLabs/gitsettle/issues/17?next=https://evil.test",
        "https://github.com/CodeMasterLabs/gitsettle/issues/0",
    ] {
        context(POSTER, REWARD + STORAGE_RESERVE, START);
        assert_panics(|| {
            contract.create_bounty(
                REPO.into(),
                url.into(),
                BountyType::Bug,
                None,
                U128(REWARD),
                DEADLINE,
            );
        });
    }
}

#[test]
fn translation_locale_is_required_normalized_and_bounded() {
    let mut contract = fresh();
    for locale in [
        None,
        Some(""),
        Some("en_US"),
        Some("ES"),
        Some("e"),
        Some("en--us"),
        Some("../../es"),
        Some("abcdefghijklmnopq"),
    ] {
        context(POSTER, REWARD + STORAGE_RESERVE, START);
        assert_panics(|| {
            contract.create_bounty(
                REPO.into(),
                ISSUE.into(),
                BountyType::Translation,
                locale.map(str::to_owned),
                U128(REWARD),
                DEADLINE,
            );
        });
    }
    for locale in ["es", "bn", "ja", "pt-br", "zh-hant"] {
        context(POSTER, REWARD + STORAGE_RESERVE, START);
        contract.create_bounty(
            REPO.into(),
            ISSUE.into(),
            BountyType::Translation,
            Some(locale.into()),
            U128(REWARD),
            DEADLINE,
        );
    }
}

#[test]
fn non_translation_rejects_locale() {
    let mut contract = fresh();
    context(POSTER, REWARD + STORAGE_RESERVE, START);
    assert_panics(|| {
        contract.create_bounty(
            REPO.into(),
            ISSUE.into(),
            BountyType::Bug,
            Some("es".into()),
            U128(REWARD),
            DEADLINE,
        );
    });
}

#[test]
fn claim_records_account_and_prevents_second_claim() {
    let mut contract = claimed();
    let bounty = contract.get_bounty(0).unwrap();
    assert_eq!(bounty.status, BountyStatus::Claimed);
    assert_eq!(bounty.claimant, Some(account(CLAIMANT)));
    context(OUTSIDER, 0, START + 2);
    assert_panics(|| {
        contract.claim_bounty(0);
    });
}

#[test]
fn poster_cannot_claim_and_expiration_is_enforced() {
    let mut contract = fresh();
    create(&mut contract);
    context(POSTER, 0, START + 1);
    assert_panics(|| {
        contract.claim_bounty(0);
    });
    context(CLAIMANT, 0, DEADLINE);
    assert_panics(|| {
        contract.claim_bounty(0);
    });
}

#[test]
fn claim_rejects_every_non_open_state() {
    let mut contract = claimed();
    for state in ALL_STATUSES
        .into_iter()
        .filter(|s| *s != BountyStatus::Open)
    {
        set_status(&mut contract, state);
        context(CLAIMANT, 0, START + 1);
        assert_panics(|| {
            contract.claim_bounty(0);
        });
    }
}

#[test]
fn submission_records_pr_and_timestamp() {
    let contract = submitted();
    let bounty = contract.bounty(0);
    assert_eq!(bounty.status, BountyStatus::Submitted);
    assert_eq!(bounty.pr_url.as_deref(), Some(PR));
    assert_eq!(bounty.submitted_at, Some(START + 2));
}

#[test]
fn submission_requires_claimant_before_deadline() {
    let mut contract = claimed();
    for caller in [POSTER, OUTSIDER, VERIFIER] {
        context(caller, 0, START + 2);
        assert_panics(|| {
            contract.submit_pr(0, PR.into());
        });
    }
    context(CLAIMANT, 0, DEADLINE);
    assert_panics(|| {
        contract.submit_pr(0, PR.into());
    });
}

#[test]
fn submission_requires_same_repository_pr_url() {
    let mut contract = claimed();
    for url in [
        ISSUE,
        "https://github.com/other/repo/pull/23",
        "http://github.com/CodeMasterLabs/gitsettle/pull/23",
        "https://github.com/CodeMasterLabs/gitsettle/pull/23/files",
        "https://github.com/CodeMasterLabs/gitsettle/pull/23#fragment",
    ] {
        context(CLAIMANT, 0, START + 2);
        assert_panics(|| {
            contract.submit_pr(0, url.into());
        });
    }
}

#[test]
fn submission_rejects_every_other_state() {
    let mut contract = claimed();
    for state in ALL_STATUSES
        .into_iter()
        .filter(|s| !matches!(s, BountyStatus::Claimed | BountyStatus::Rejected))
    {
        set_status(&mut contract, state);
        context(CLAIMANT, 0, START + 2);
        assert_panics(|| {
            contract.submit_pr(0, PR.into());
        });
    }
}

#[test]
fn oracle_rejection_allows_corrected_submission() {
    let mut contract = submitted();
    context(VERIFIER, 0, START + 3);
    let rejected = contract.reject_submission(0, "PR does not reference issue #17".into());
    assert_eq!(rejected.status, BountyStatus::Rejected);
    assert!(rejected.rejection_reason.is_some());
    context(CLAIMANT, 0, START + 4);
    let corrected = contract.submit_pr(
        0,
        "https://github.com/CodeMasterLabs/gitsettle/pull/24".into(),
    );
    assert_eq!(corrected.status, BountyStatus::Submitted);
    assert!(corrected.rejection_reason.is_none());
    assert_eq!(corrected.submitted_at, Some(START + 4));
}

#[test]
fn only_verifier_may_reject_even_after_deadline() {
    let mut contract = submitted();
    for caller in [POSTER, CLAIMANT, OUTSIDER] {
        context(caller, 0, DEADLINE + 1);
        assert_panics(|| {
            contract.reject_submission(0, "Invalid".into());
        });
    }
    context(VERIFIER, 0, DEADLINE + 1);
    assert_eq!(
        contract
            .reject_submission(0, "Closed without merge".into())
            .status,
        BountyStatus::Rejected
    );
    context(CLAIMANT, 0, DEADLINE + 1);
    assert_panics(|| {
        contract.submit_pr(0, PR.into());
    });
}

#[test]
fn rejection_requires_submission_and_bounded_nonempty_reason() {
    let mut contract = submitted();
    for reason in ["".to_owned(), " ".to_owned(), "x".repeat(301)] {
        context(VERIFIER, 0, START + 3);
        assert_panics(|| {
            contract.reject_submission(0, reason);
        });
    }
    for state in ALL_STATUSES
        .into_iter()
        .filter(|s| *s != BountyStatus::Submitted)
    {
        set_status(&mut contract, state);
        context(VERIFIER, 0, START + 3);
        assert_panics(|| {
            contract.reject_submission(0, "Invalid".into());
        });
    }
}

#[test]
fn release_schedules_exact_reward_to_claimant_and_private_callback() {
    let mut contract = submitted();
    context(VERIFIER, 0, DEADLINE + 1);
    drop(contract.release(0));
    assert_eq!(contract.bounty(0).status, BountyStatus::Releasing);
    assert_eq!(contract.get_profile(account(CLAIMANT)).points, 0);
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 2);
    assert_eq!(receipts[0].receiver_id, account(CLAIMANT));
    assert!(receipts[0].actions.iter().any(|action| matches!(action, MockAction::Transfer { deposit, .. } if deposit.as_yoctonear() == REWARD)));
    assert_eq!(receipts[1].receiver_id, account(CONTRACT));
    assert!(receipts[1].actions.iter().any(|action| matches!(action, MockAction::FunctionCallWeight { method_name, prepaid_gas, .. } if method_name == b"on_release" && *prepaid_gas == CALLBACK_GAS)));
}

#[test]
fn poster_may_authorize_release() {
    let mut contract = submitted();
    context(POSTER, 0, START + 3);
    drop(contract.release(0));
    assert_eq!(contract.bounty(0).status, BountyStatus::Releasing);
}

#[test]
fn unauthorized_accounts_cannot_release() {
    let mut contract = submitted();
    for caller in [CLAIMANT, OUTSIDER] {
        context(caller, 0, START + 3);
        assert_panics(|| {
            drop(contract.release(0));
        });
    }
}

#[test]
fn release_rejects_every_non_submitted_state_including_pending() {
    let mut contract = submitted();
    for state in ALL_STATUSES
        .into_iter()
        .filter(|s| *s != BountyStatus::Submitted)
    {
        set_status(&mut contract, state);
        context(VERIFIER, 0, START + 3);
        assert_panics(|| {
            drop(contract.release(0));
        });
    }
}

#[test]
fn successful_release_awards_points_once() {
    let mut contract = submitted();
    context(VERIFIER, 0, START + 3);
    drop(contract.release(0));
    callback(CONTRACT, true);
    assert!(contract.on_release(0));
    assert_eq!(contract.bounty(0).status, BountyStatus::Released);
    assert_eq!(contract.bounty(0).settled_at, Some(DEADLINE + 1));
    let profile = contract.get_profile(account(CLAIMANT));
    assert_eq!(
        (profile.points, profile.merged_count, profile.total_earned.0),
        (100, 1, REWARD)
    );
    assert_eq!(contract.get_leaderboard(None, None), vec![profile.clone()]);
    assert_panics(|| {
        contract.on_release(0);
    });
    assert_eq!(contract.get_profile(account(CLAIMANT)), profile);
    context(VERIFIER, 0, DEADLINE + 1);
    assert_panics(|| {
        drop(contract.release(0));
    });
}

#[test]
fn failed_release_restores_submission_and_can_retry() {
    let mut contract = submitted();
    context(VERIFIER, 0, START + 3);
    drop(contract.release(0));
    callback(CONTRACT, false);
    assert!(!contract.on_release(0));
    assert_eq!(contract.bounty(0).status, BountyStatus::Submitted);
    assert_eq!(contract.get_profile(account(CLAIMANT)).points, 0);
    assert!(contract.bounty(0).settled_at.is_none());
    context(VERIFIER, 0, DEADLINE + 2);
    drop(contract.release(0));
    callback(CONTRACT, true);
    assert!(contract.on_release(0));
    assert_eq!(contract.get_profile(account(CLAIMANT)).merged_count, 1);
}

#[test]
fn callbacks_are_private_and_require_transfer_result() {
    let mut contract = submitted();
    context(VERIFIER, 0, START + 3);
    drop(contract.release(0));
    for caller in [POSTER, CLAIMANT, VERIFIER, OUTSIDER] {
        callback(caller, true);
        assert_panics(|| {
            contract.on_release(0);
        });
        assert_panics(|| {
            contract.on_refund(0);
        });
    }
    context(CONTRACT, 0, DEADLINE + 1);
    assert_panics(|| {
        contract.on_release(0);
    });
    assert_panics(|| {
        contract.on_refund(0);
    });
}

#[test]
fn callback_requires_correct_pending_state() {
    let mut contract = submitted();
    for state in ALL_STATUSES {
        set_status(&mut contract, state);
        callback(CONTRACT, true);
        if state != BountyStatus::Releasing {
            assert_panics(|| {
                contract.on_release(0);
            });
        }
        if state != BountyStatus::Refunding {
            assert_panics(|| {
                contract.on_refund(0);
            });
        }
    }
}

#[test]
fn refund_requires_poster_and_deadline() {
    let mut contract = fresh();
    create(&mut contract);
    for caller in [CLAIMANT, VERIFIER, OUTSIDER] {
        context(caller, 0, DEADLINE + 1);
        assert_panics(|| {
            drop(contract.refund(0));
        });
    }
    context(POSTER, 0, DEADLINE - 1);
    assert_panics(|| {
        drop(contract.refund(0));
    });
}

#[test]
fn refund_rejects_submission_and_every_pending_or_settled_state() {
    let mut contract = submitted();
    for state in [
        BountyStatus::Submitted,
        BountyStatus::Releasing,
        BountyStatus::Released,
        BountyStatus::Refunding,
        BountyStatus::Refunded,
    ] {
        set_status(&mut contract, state);
        context(POSTER, 0, DEADLINE + 1);
        assert_panics(|| {
            drop(contract.refund(0));
        });
    }
}

#[test]
fn expired_open_claimed_and_rejected_bounties_refund_exact_reward() {
    for state in [
        BountyStatus::Open,
        BountyStatus::Claimed,
        BountyStatus::Rejected,
    ] {
        let mut contract = submitted();
        set_status(&mut contract, state);
        context(POSTER, 0, DEADLINE);
        drop(contract.refund(0));
        assert_eq!(contract.bounty(0).status, BountyStatus::Refunding);
        let receipts = get_created_receipts();
        assert_eq!(receipts[0].receiver_id, account(POSTER));
        assert!(receipts[0].actions.iter().any(|action| matches!(action, MockAction::Transfer { deposit, .. } if deposit.as_yoctonear() == REWARD)));
        callback(CONTRACT, true);
        assert!(contract.on_refund(0));
        assert_eq!(contract.bounty(0).status, BountyStatus::Refunded);
        assert_eq!(contract.get_profile(account(CLAIMANT)).points, 0);
        assert!(contract.get_leaderboard(None, None).is_empty());
        assert_panics(|| {
            contract.on_refund(0);
        });
        context(POSTER, 0, DEADLINE + 2);
        assert_panics(|| {
            drop(contract.refund(0));
        });
        drop(contract);
    }
}

#[test]
fn failed_refund_restores_each_original_state_and_allows_retry() {
    for state in [
        BountyStatus::Open,
        BountyStatus::Claimed,
        BountyStatus::Rejected,
    ] {
        let mut contract = fresh();
        create(&mut contract);
        if state != BountyStatus::Open {
            context(CLAIMANT, 0, START + 1);
            contract.claim_bounty(0);
        }
        if state == BountyStatus::Rejected {
            context(CLAIMANT, 0, START + 2);
            contract.submit_pr(0, PR.into());
            context(VERIFIER, 0, START + 3);
            contract.reject_submission(0, "Closed without merge".into());
        }
        context(POSTER, 0, DEADLINE + 1);
        drop(contract.refund(0));
        callback(CONTRACT, false);
        assert!(!contract.on_refund(0));
        assert_eq!(contract.bounty(0).status, state);
        assert!(contract.bounty(0).settled_at.is_none());
        context(POSTER, 0, DEADLINE + 2);
        drop(contract.refund(0));
        callback(CONTRACT, true);
        assert!(contract.on_refund(0));
        drop(contract);
    }
}

#[test]
fn settlement_requires_enough_gas_to_finalize_callback() {
    let mut contract = submitted();
    let mut low_gas = builder(VERIFIER, 0, START + 3);
    low_gas.prepaid_gas(Gas::from_tgas(59));
    testing_env!(low_gas.build());
    assert_panics(|| {
        drop(contract.release(0));
    });
    set_status(&mut contract, BountyStatus::Rejected);
    let mut low_gas = builder(POSTER, 0, DEADLINE + 1);
    low_gas.prepaid_gas(Gas::from_tgas(59));
    testing_env!(low_gas.build());
    assert_panics(|| {
        drop(contract.refund(0));
    });
}

#[test]
fn nonpayable_methods_reject_attached_funds() {
    let mut contract = submitted();
    context(CLAIMANT, 1, START + 3);
    assert_panics(|| {
        contract.claim_bounty(0);
    });
    assert_panics(|| {
        contract.submit_pr(0, PR.into());
    });
    context(VERIFIER, 1, START + 3);
    assert_panics(|| {
        contract.reject_submission(0, "Invalid".into());
    });
    assert_panics(|| {
        drop(contract.release(0));
    });
    context(POSTER, 1, DEADLINE + 1);
    assert_panics(|| {
        drop(contract.refund(0));
    });
}

#[test]
fn mutations_fail_cleanly_for_missing_id() {
    let mut contract = fresh();
    context(CLAIMANT, 0, START + 1);
    assert_panics(|| {
        contract.claim_bounty(999);
    });
    assert_panics(|| {
        contract.submit_pr(999, PR.into());
    });
    context(VERIFIER, 0, START + 1);
    assert_panics(|| {
        contract.reject_submission(999, "Invalid".into());
    });
    assert_panics(|| {
        drop(contract.release(999));
    });
    context(POSTER, 0, DEADLINE + 1);
    assert_panics(|| {
        drop(contract.refund(999));
    });
}

#[test]
fn bounty_pagination_is_bounded_and_overflow_safe() {
    let mut contract = fresh();
    for _ in 0..102 {
        create(&mut contract);
    }
    assert_eq!(contract.list_bounties(None, None).len(), 50);
    assert_eq!(contract.list_bounties(None, Some(u64::MAX)).len(), 100);
    assert_eq!(contract.list_bounties(Some(100), Some(100)).len(), 2);
    assert_eq!(contract.list_bounties(Some(2), Some(1))[0].id, 2);
    assert!(
        contract
            .list_bounties(Some(u64::MAX), Some(u64::MAX))
            .is_empty()
    );
    assert!(contract.list_bounties(None, Some(0)).is_empty());
}

#[test]
fn leaderboard_is_stable_bounded_and_promotes_returning_contributors() {
    let mut contract = fresh();
    for i in 0..102 {
        let entry = Contributor {
            account_id: account(&format!("person{i:03}.testnet")),
            points: 100,
            merged_count: 1,
            total_earned: U128(REWARD),
        };
        contract
            .contributors
            .insert(entry.account_id.clone(), entry.clone());
        contract.update_leaders(entry);
    }
    let leaders = contract.get_leaderboard(None, Some(200));
    assert_eq!(leaders.len(), 100);
    assert_eq!(leaders[0].account_id, account("person000.testnet"));
    let mut returning = contract.profile(&account("person101.testnet"));
    returning.points += 100;
    returning.merged_count += 1;
    returning.total_earned = U128(REWARD * 2);
    contract.update_leaders(returning.clone());
    assert_eq!(contract.get_leaderboard(None, Some(1)), vec![returning]);
    assert_eq!(contract.get_leaderboard(Some(99), Some(100)).len(), 1);
    assert!(contract.get_leaderboard(Some(u64::MAX), None).is_empty());
}

#[test]
fn existing_contributor_accumulates_points_and_earnings() {
    let mut contract = submitted();
    for id in 0..2 {
        if id == 1 {
            create(&mut contract);
            context(CLAIMANT, 0, START + 1);
            contract.claim_bounty(id);
            contract.submit_pr(id, PR.into());
        }
        context(VERIFIER, 0, START + 3);
        drop(contract.release(id));
        callback(CONTRACT, true);
        contract.on_release(id);
    }
    let profile = contract.profile(&account(CLAIMANT));
    assert_eq!(
        (profile.points, profile.merged_count, profile.total_earned.0),
        (200, 2, 2 * REWARD)
    );
    assert_eq!(contract.get_leaderboard(None, None).len(), 1);
}

#[test]
fn maximum_record_lifecycle_storage_fits_fixed_reserve() {
    let mut contract = fresh();
    flush(&mut contract);
    let initial_storage = env::storage_usage();
    let long_poster = "p".repeat(64);
    let long_claimant = "c".repeat(64);
    let repo = format!("{}/{}", "o".repeat(70), "r".repeat(69));
    let issue = format!("https://github.com/{repo}/issues/9999999999999999");
    let pr = format!("https://github.com/{repo}/pull/9999999999999999");
    context(&long_poster, MAX_REWARD + STORAGE_RESERVE, START);
    contract.create_bounty(
        repo,
        issue,
        BountyType::Translation,
        Some("abcdefg-abcdefgh".into()),
        U128(MAX_REWARD),
        DEADLINE,
    );
    context(&long_claimant, 0, START + 1);
    contract.claim_bounty(0);
    contract.submit_pr(0, pr.clone());
    context(VERIFIER, 0, START + 2);
    contract.reject_submission(0, "x".repeat(300));
    flush(&mut contract);
    let rejected_bytes = env::storage_usage() - initial_storage;
    context(&long_claimant, 0, START + 3);
    contract.submit_pr(0, pr);
    context(VERIFIER, 0, START + 4);
    drop(contract.release(0));
    callback(CONTRACT, true);
    contract.on_release(0);
    flush(&mut contract);
    let released_bytes = env::storage_usage() - initial_storage;
    let worst_bytes = rejected_bytes.max(released_bytes);
    let storage_cost = u128::from(worst_bytes) * env::storage_byte_cost().as_yoctonear();
    assert!(
        storage_cost <= STORAGE_RESERVE,
        "{worst_bytes} bytes cost {storage_cost} yoctoNEAR, exceeding reserve"
    );
    println!(
        "maximum lifecycle: {worst_bytes} bytes; reserve funds {} bytes",
        STORAGE_RESERVE / env::storage_byte_cost().as_yoctonear()
    );
}

#[test]
fn full_leaderboard_callback_fits_allocated_gas() {
    let mut contract = submitted();
    for i in 0..100 {
        contract.update_leaders(Contributor {
            account_id: account(&format!("person{i:03}.testnet")),
            points: 100,
            merged_count: 1,
            total_earned: U128(REWARD),
        });
    }
    context(VERIFIER, 0, START + 3);
    drop(contract.release(0));
    let mut cb = builder(CONTRACT, 0, DEADLINE + 1);
    cb.prepaid_gas(CALLBACK_GAS);
    testing_env!(
        cb.build(),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        HashMap::default(),
        vec![PromiseResult::Successful(vec![])]
    );
    assert!(contract.on_release(0));
    flush(&mut contract);
    assert!(env::used_gas() < CALLBACK_GAS);
    println!(
        "full leaderboard callback used {} Tgas",
        env::used_gas().as_tgas()
    );
}

#[test]
fn wire_amounts_are_strings_and_status_names_are_stable() {
    let mut contract = fresh();
    let bounty = create(&mut contract);
    let wire = near_sdk::serde_json::to_value(&bounty).unwrap();
    assert_eq!(wire["reward"], REWARD.to_string());
    assert_eq!(wire["status"], "Open");
    assert_eq!(wire["deadline"], DEADLINE);
    assert_eq!(wire["poster"], POSTER);
}
