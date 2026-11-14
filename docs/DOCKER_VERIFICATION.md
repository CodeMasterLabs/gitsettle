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
