# AgentGuard source subset

Upstream: https://github.com/CodeMasterLabs/agentguard

Pinned commit: `4ec34e69bc7c6cfd17a3e027bf9727a67eab97f6`

`oracle/src/rules.ts`, `oracle/src/injection.ts`, `sdk/src/types.ts` and `LICENSE`
are byte-for-byte copies of the files at that commit. `UPSTREAM.json` records
their SHA-256 hashes. Preserve the upstream MIT copyright/license notice.

`sdk-bridge.d.ts`, this README and the manifest are GitSettle integration files.
The bridge resolves an erased upstream type-only import to the copied SDK types;
it does not install or execute the upstream SDK. No upstream source is patched.

Only the local deterministic risk rules and text heuristics run in GitSettle.
AgentGuard's vault contract, signed attestations, TEE/OutLayer runtime, LLM oracle,
cross-chain settlement and period budget engine are **not** part of this subset.
See [integration and limits](../../docs/AGENTGUARD.md).
