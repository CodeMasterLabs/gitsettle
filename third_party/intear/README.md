# Intear wallet executor

These unmodified source files come from
[INTEARnear/wallet at fd91b3303cdca314c2647c7f2ad7873fc9843b04](https://github.com/INTEARnear/wallet/tree/fd91b3303cdca314c2647c7f2ad7873fc9843b04).
The wallet adapter (`web/src/js/near-selector.js`) is covered by the upstream
[GNU AGPL v3 license](LICENSE). Its imported connector is covered by its own
[MIT license](intearwallet-connect/LICENSE). These licenses apply to their
respective files; they are not relicensed as GitSettle's MIT code.

The executable is built only from these sources. From the repository root,
using esbuild **0.28.2** (installed by the lockfile):

```sh
npx esbuild third_party/intear/web/src/js/near-selector.js \
  --bundle --minify --format=esm --target=es2022 \
  --define:__NEARCONNECT__=true \
  --outfile=apps/web/public/wallets/intear-executor-b820dd8c6cfe.js
```

SHA-256: `b820dd8c6cfed1a3ff72312cba66e6885a8aa2ffe272f0369664702538e3b8f5`.
The `__NEARCONNECT__` flag enables the upstream sandbox integration; omitting it
leaves an unresolved runtime constant and breaks connection.
The complete corresponding source for this standalone executor is included
here, together with its licenses and build command. The rest of the upstream
wallet application is not bundled into GitSettle.

GitSettle invokes this adapter as a separate NEAR Connect sandbox executor. No
function-call key is requested. Intear stores a connector authentication key
and session metadata in its sandbox-scoped browser storage; it is not the
user's on-chain NEAR account key. Sign-out clears that connector storage.
The adapter does not forward `callbackUrl` for NEP-413, so private support
sign-in is disabled for this provider. Escrow transaction signing is available.
