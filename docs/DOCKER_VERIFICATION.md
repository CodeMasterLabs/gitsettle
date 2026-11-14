# Clean-clone Docker verification

Verified on November 14, 2026, on the authorized Ubuntu 26.04.1 VPS with Docker
29.9.3 and Compose 5.7.1. Public source revision:
[`9ca2b56613753c751a37a62617723a23d55a9e3c`](https://github.com/CodeMasterLabs/gitsettle/commit/9ca2b56613753c751a37a62617723a23d55a9e3c).

The source directory was empty, `gitsettle:local` did not exist, and no `.env`,
wallet credentials or private source archive was transferred. The public repo
was cloned directly and started with:

```sh
git clone https://github.com/CodeMasterLabs/gitsettle.git /opt/gitsettle/source
cd /opt/gitsettle/source
APP_BIND=127.0.0.1 APP_PORT=3000 docker compose up --detach --wait
```

Compose automatically built the image, installed locked dependencies, built
Next.js, created its named data volume and started both processes. Web health
passed and the verifier reported its expected demo idle mode. The initial image
ID was `sha256:1792994dc62f4a4e6f3896a8aacd1826ed1e9edf5b5174e3a6729a1a5ed3a2f3`.
Node reported `v22.23.0` inside the runtime.

Public HTTPS checks against `https://gitsettle.89.167.109.196.sslip.io` returned:

| Endpoint | Result |
| --- | --- |
| `/api/health` | 200; `status: ok` |
| `/api/config` | 200; `mode: demo`, no configured contract |
| `/api/bounties` | 200; eight explicitly labeled examples |
| `/api/leaderboard` | 200; four example contributors |
| `/`, `/bounties/0`, `/bounties/new` | All 200 |
| `/leaderboard`, `/contributors/maya.demo.testnet`, `/dashboard` | All 200 |

TLS was checked with normal certificate validation. The existing Caddy
configuration was not modified. The app is bound only to host loopback port 3000.

Both containers run as `1000:1000` with read-only root filesystems. A runtime
check verified that the web environment contained no NEAR private key or GitHub
token and that no local `.env` or provisioned wallet file existed in the image.
Both processes could access `/data/gitsettle.sqlite`.

For persistence, the web API created its real `demo:v1` leaderboard snapshot;
the verifier container read that same snapshot. Both containers were recreated
with `docker compose up --force-recreate --detach --wait`, and the verifier read
the unchanged snapshot again: timestamp `1794614400000`, four contributors.
The working tree remained clean. The named volume was retained.

This records the default clean-clone demo checkpoint at the stated revision.
Later testnet configuration, feature upgrades and payout verification are separate
checkpoints in `STATUS.md`; this demo startup did not sign transactions.

## Live testnet deployment: November 14, 2026

A separate, read-only inspection at approximately **09:24–09:27 UTC** verified
the published revision
[`5665b616cb0bae4a513bcb9a46727b51a5603c10`](https://github.com/CodeMasterLabs/gitsettle/commit/5665b616cb0bae4a513bcb9a46727b51a5603c10)
at **https://gitsettle.89.167.109.196.sslip.io**. The VPS checkout matched public
`main`, used the canonical public GitHub remote, had a clean working tree, and
contained no local `.env` file. This was an upgrade of the existing installation;
the earlier section records the independent default clean-clone test.

Both services used image
`sha256:1065b07ed0e19a0e52ce7aea254696b3621b8eee2beb86c5e39403c9ae53b487`.
Web started at `09:20:31 UTC`, verifier at `09:20:37 UTC`; both were running with
zero restarts. Docker reported web health as `healthy`. The verifier has no
separate Docker healthcheck, so its checks were process state, startup log
summary, and the finalized account/key reads below.

| Read-only check | Result |
| --- | --- |
| Public `/api/health` | HTTPS 200; `status: ok` |
| Public `/api/config` | HTTPS 200; `mode: testnet`, contract `gitsettle-ac1b0f23f4.testnet` |
| Automatic-payout configuration | AgentGuard enabled; 5 NEAR per-payout cap |
| Public `/api/ai/chat` | HTTPS 200; `configured: false`, no paid provider configured |
| Host application binding | `127.0.0.1:3000`; verifier publishes no ports |
| Canonical origin/proxy | Public HTTPS origin configured; trusted proxy headers enabled behind Caddy |
| Runtime restrictions | Both use UID/GID `1000:1000`, read-only root filesystems, all capabilities dropped, and `no-new-privileges` |

Credential isolation was checked by inspecting variable **names and presence**,
never printing credential values. The web environment contained no verifier,
poster, or contributor NEAR account/signing variables, no NEAR private-key
variables, and no GitHub variables. The image environment contained no private
key, token, or API-key variables. Image build history contained no exact match
for the configured runtime secrets.

A read-only scan of 746 application/build files under `/app` found no `.env`
files other than the public example, credential directories, `.pem`/`.key`
files, or exact copy of the active verifier private key. This application scan
excluded `node_modules` and did not claim an exhaustive forensic scan of every
image byte. The host secret directory remained root-owned mode `0700`; its one
environment file was root-owned mode `0600` and outside the public checkout.

The verifier environment named `verifier.gitsettle-ac1b0f23f4.testnet`. A finalized
`get_config` read confirmed that this is the contract's configured verifier.
Deriving the configured signer's public key in memory and making a finalized
`view_access_key` read confirmed its active `FullAccess` permission at block
`277638189`. No signing operation was performed and no key material was returned
by the inspection.

Both containers mount the same host directory, `/opt/gitsettle/data`, at `/data`.
The host directory is owned by `1000:1000` with mode `0750`. Read-only SQLite
connections from both containers reported WAL mode, the same database device
and inode, and the same application/community tables. The live database held a
testnet leaderboard snapshot for `gitsettle-ac1b0f23f4.testnet`, timestamp
`1794614400000`, with one contributor. This confirms shared, host-backed live
storage; this inspection did not recreate containers or alter that data. The
original demo checkpoint above separately verified persistence through actual
container recreation with its named volume.

Only the last 30 available log lines per service were examined, with output
reduced to counts and marker checks. No fatal/unhandled-error marker or obvious
credential-format marker was found. Containers, source checkout, environment,
and configuration were not modified. Support smoke tests and the escrow payout
loop are separate evidence in `STATUS.md` and the corresponding E2E records.
