# Wallet connections

GitSettle runs on NEAR **Testnet**. Connect wallet opens a custom keyboard-accessible
dialog immediately. It does not download signing code until a provider is chosen
or an existing connection needs restoration.

| Provider | Connection | Escrow | Private support sign-in |
| --- | --- | --- | --- |
| MyNearWallet | Browser popup | Yes | NEP-413 |
| Meteor Wallet | Browser popup through NEAR Connect | Yes | NEP-413 |
| Intear Wallet | Web/mobile through NEAR Connect | Yes | Unavailable with this adapter |
| Nightly | Installed, unlocked browser extension | Yes | NEP-413 |

Choose Testnet in your wallet. Nightly displays installation guidance when its
extension is absent. After connecting, the account button opens account details,
copy, explorer/profile links, account selection when the provider supplies multiple
accounts, switch-wallet and disconnect actions. The wallet can require its own
account-switch UI.

Private support requires an additional domain-bound signed message and an active
FullAccess key on the account; connecting alone is not authentication. Intear's
current adapter drops the callback URL from this message. GitSettle therefore
refuses its support sign-in and names compatible alternatives. It does not weaken
server verification to accommodate the adapter. No WalletConnect/Reown project is
configured, so WalletConnect-only and mainnet-only providers are not advertised.

## Implementation and boundaries

- Wallet Selector **10.1.4** continues to own selected-account state and the
  existing action interface. MyNearWallet and Nightly load their pinned selector
  modules. `wallet-modules.ts` registers only light metadata up front.
- Meteor and Intear use **NEAR Connect 0.12.0**, the connector family also used by
  AgentGuard. A small bridge adapts its sandboxed wallets to Wallet Selector.
  GitSettle supplies an empty dynamic registry and uses only the two explicitly
  pinned entries in `wallet-manifest.json`; new providers cannot appear through
  a remotely updated manifest.
- No connection requests an on-chain function-call key. New MyNearWallet
  connections omit the contract argument at the wallet boundary. An older saved
  `functionCallKey` blocks signing and prompts disconnect/reconnect; deleting its
  local copy does **not** revoke an old on-chain key. Revoke it in the wallet's
  access-key settings.
- Wallet providers retain transaction approval and account signing. Intear also
  persists a connector authentication key in its sandbox-scoped browser storage;
  this is a session credential, not the account's NEAR signing key. Sign-out
  clears connector storage. Never treat browser storage as a secret vault.
- Provider/account changes clear the separate support session. Signing is
  guarded against concurrent connection changes, and each transaction explicitly
  names its signer. A provider switch does not erase a pending escrow intent.
- Support signatures and session responses are bound to the current connection
  request. A wallet/account change invalidates older responses; a late session
  cookie is explicitly signed out before another support sign-in can start.
- Cancellation, lost popup results and ambiguous broadcasts do not imply a
  payment failed. Persisted intent is recovered before optional wallet downloads.
  The server still verifies signer, receiver, method, arguments, finality and
  contract state before the app announces confirmation.

The sandbox is an isolation boundary, not proof that a wallet is trustworthy.
NEAR Connect runs executors in opaque-origin `allow-scripts` frames and brokers
their declared storage, popup and extension permissions. Its message protocol
uses per-frame/per-call random identifiers. The provider sites/extensions, their
RPC interactions, NEAR Connect and Wallet Selector remain dependencies. Users
must review the account, contract, action and attached amount in their wallet.

## Pinned executors and licenses

Meteor's executor is fetched on demand from
[commit 6369ad789d2f3aaf8e6ccb065021723111027174](https://github.com/Meteor-Wallet/meteor_wallet_sdk/tree/6369ad789d2f3aaf8e6ccb065021723111027174),
path `storage/meteor-near-connect-latest.js`. Despite that filename, the URL pins
an immutable commit. Observed SHA-256:
`e1795611500188077a6eadd5597b03b840f6d530f5e2904b621b378f8e007c73`.
The upstream repository carries [GPL v3](https://github.com/Meteor-Wallet/meteor_wallet_sdk/blob/6369ad789d2f3aaf8e6ccb065021723111027174/LICENSE).
GitSettle does not relabel this external executor as its own MIT code.

Intear's standalone executor is served from a content-addressed local asset,
rebuilt from its checked-in corresponding source. Its AGPL v3 adapter, MIT
connector, complete source, licenses, exact upstream commit, hash and reproducible
build command are in [third_party/intear](../third_party/intear/README.md).
The remaining GitSettle application retains its MIT license. Wallet logos identify
their respective providers and are not a claim of partnership.

Updating either executor requires a source review, new pin/version, and the
connection, message, recovery and browser checks. An unavailable pinned provider
must show an actionable error; never silently replace it with mutable code.

## Verification scope

Browser checks use the actual selector modules with an injected Nightly fixture,
a MyNearWallet popup boundary, and the actual NEAR Connect sandbox with explicit
executor fixtures. They cover provider choice, no-key Testnet connection,
message fields, cancellation, account changes, logout, focus and recovery.
Additional race checks delay a fixture signature or HTTP session response, then
change accounts or disconnect and verify that old private identity cannot return.
The Intear startup regression keeps the shipped local executor and replaces only
its external pairing screen with a cancelling fixture. This checks the executable
build, sandbox startup and cancellation, including the required upstream
`__NEARCONNECT__` build flag. These checks never contain a NEAR private key and do
not claim real provider approvals.

A separate November 14, 2026 browser smoke loaded the actual Meteor executor from
its pinned commit with HTTP 200 and opened its Testnet login popup. Meteor's
Cloudflare protection blocked this environment at the provider site, so account
approval and message/transaction signing were not verified. The corrected Intear
executor loaded its actual hosted pairing screen and displayed the Web/App
connection choices without JavaScript errors. No account was connected and no
provider signature or transaction was requested in either smoke.

Live signed HTTP authentication and the existing real escrow payout are separate
evidence in [COMMUNITY_E2E.json](COMMUNITY_E2E.json) and
[LIVE_E2E.json](LIVE_E2E.json). See [UI_REVIEW.md](UI_REVIEW.md) for the latest
executed browser results and screenshot review.
