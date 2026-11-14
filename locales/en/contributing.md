# Contribute with GitSettle

1. Open the work queue and choose an issue you can complete. For a translation,
   check the locale badge and the required file path before claiming it.
2. Connect a NEAR testnet wallet. Open the bounty and choose **Claim this bounty**.
   The account that claims the work is the account that will receive the reward.
3. Make the change in a GitHub pull request targeting the bounty's repository.
   Follow the issue's acceptance criteria and ask the maintainer to review it.
4. Copy the two proof lines from the bounty into the pull request description:

   ```text
   Closes https://github.com/CodeMasterLabs/gitsettle/issues/ISSUE_NUMBER
   GitSettle: CONTRACT_ACCOUNT/BOUNTY_ID/YOUR_TESTNET_ACCOUNT
   ```

   Replace each placeholder with the value shown on the bounty. Put the actual
   lines in the PR body as plain text, outside a code block or quote.
5. Submit the PR URL on the bounty page **before the deadline**. The PR can merge
   later; a timely submitted PR stays protected while verification is pending.
6. After merge, the verifier checks the repository, issue, wallet marker, and
   requested locale path. A successful NEAR transfer changes the bounty to
   Settled and credits contribution points to your account.

The reward is held in a NEAR contract. The verifier is a trusted service, and the
poster can also authorize payment. GitSettle does not independently judge code
or translation quality. Read the [trust model](../../README.md#trust-model-and-limitations)
before using it. The supplied deployment uses testnet tokens with no real value.

If verification cannot reach GitHub, wait for the next check. Do not submit a
second payment or reveal your wallet's private key. An API outage is not a failed
contribution, and a wallet redirect is not proof that a transaction succeeded.
