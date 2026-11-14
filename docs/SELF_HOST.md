# Self-host GitSettle

The web app and verifier share a persistent SQLite database. NEAR contract state
is the authority for escrow and reputation; SQLite stores the app's cache and
verification history. Both containers run as UID/GID 1000 with read-only root
filesystems. Only the web app publishes a port. The verifier receives its signing
key and optional GitHub token; neither is passed to the web container.

## Start a local demo

Install Docker Engine and the Compose plugin, then:

```sh
git clone https://github.com/CodeMasterLabs/gitsettle.git
cd gitsettle
docker compose up --build
```

Open `http://localhost:3000`. With no `.env` and no contract setting, the app
shows its explicitly labeled demo data and the worker performs no transactions.
The first build installs the lockfile and compiles Next.js; subsequent starts
reuse that image. Once built, the requested `docker compose up` is sufficient.

SQLite persists in the `gitsettle-data` Compose volume across ordinary stops,
restarts and rebuilds. `docker compose down` retains it. `down --volumes` deletes
that data and should be used only when intentionally resetting the installation.

```sh
docker compose ps
docker compose logs --tail=100 web verifier
docker compose down
```

The web health check uses `/api/health`. The verifier waits for a healthy web
process before starting and logs each verification decision. Its demo-mode idle
message is expected. A live worker that lacks a matching key or account fails
closed; check its logs and the configured contract's `get_config` response.

## Connect a testnet contract

Copy `.env.example` to `.env`, set `DEMO_MODE=false`, and configure the deployed
`NEAR_CONTRACT_ID`, immutable `NEAR_VERIFIER_ACCOUNT_ID`, and that verifier's
`NEAR_VERIFIER_PRIVATE_KEY`. Use only the testnet key intended for this deployment.
Set `GITHUB_TOKEN` for higher API rate limits if available. The worker reads public
repositories, so a token with public repository read access is sufficient.

```sh
chmod 600 .env
docker compose up --build --detach --wait
```

Do not use `env_file: .env` on the web service. The checked-in Compose file
intentionally selects individual environment variables so operator keys never
enter the web process. Likewise, `.dockerignore` excludes local secrets, SQLite,
wallet credentials and build output from the image context. Public settings are
read at runtime rather than baking deployment keys or account IDs into a build.

The contract deployer/seed keys are not needed by either long-running container.
Keep those in a separate protected operator environment. Container environment
variables are visible to host root and Docker administrators; secure host access
accordingly. This is an operator-controlled trusted verifier, not protected key
execution in a hardware enclave.

## Dedicated VPS layout

The prepared Ubuntu VPS uses:

```text
/opt/gitsettle/source/                 reviewed application source, no secrets
/opt/gitsettle/data/                   SQLite files, owner 1000:1000, mode 0750
/opt/gitsettle/env/production.env      root-owned runtime environment, mode 0600
```

`/opt/gitsettle/env` is root-owned mode 0700. Docker Engine 29.9.3 and Compose
5.7.1 were installed from Docker's official Ubuntu apt repository on Ubuntu
26.04.1, and `hello-world` succeeded. This preparation did not itself deploy the
application. Live deployment and external reachability belong in `STATUS.md`.

After copying the tested source tree, create the protected environment from
`deploy/vps.env.example`. It defaults to port 80 and the persistent host data
directory. Supply the actual verifier configuration separately. Run on the VPS:

```sh
bash /opt/gitsettle/source/deploy/vps-up.sh
```

The script validates Compose without printing resolved secrets, builds the image,
starts both services, waits for web health and prints service status. It does not
copy any keys or source files itself. When synchronizing source, exclude `.git`,
`.env*`, `.secrets`, `node_modules`, `.next`, `target`, database files and local
browser artifacts. Never place `production.env` below `source/`.

An IP-only port-80 deployment provides HTTP. For a permanent public deployment,
point a domain at the VPS, terminate HTTPS with the reverse proxy of your choice,
and bind the web port to loopback using `APP_BIND=127.0.0.1`. Configure the wallet's
return URL against that public HTTPS origin. The repository does not assume
ownership of a domain or request certificates for an invented hostname.

## Back up and recover

Stop both services briefly for a consistent filesystem backup. Copy the entire
data directory, including any SQLite WAL/SHM files, into a protected backup
location; never copy only the main database while writers are running. Restart
the services after the copy. Restore with services stopped and preserve ownership
1000:1000. NEAR escrow survives local data loss, but local verification history
and rank snapshots require this backup.

For an upgrade, back up the database, deploy the reviewed source revision,
rebuild with `docker compose up --build --detach --wait`, and inspect web and
verifier health. Keep the prior source revision and image until the new revision
is verified. Schema changes require an explicit migration and rollback plan.

## Documentation sources

Verified November 14, 2026:

- [Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/): apt
  signing key, official repository, engine/CLI/containerd/Buildx/Compose packages.
- [Compose services](https://docs.docker.com/reference/compose-file/services/):
  health checks, startup dependencies, selected environment, read-only runtime.
- [Official Node image](https://hub.docker.com/_/node): Node 22.23.0 Bookworm slim
  multi-platform digest is pinned in `Dockerfile`.
- Official action READMEs for [checkout](https://github.com/actions/checkout),
  [setup-node](https://github.com/actions/setup-node) and
  [upload-artifact](https://github.com/actions/upload-artifact): current v7 refs
  were resolved and pinned to commit hashes in the workflow.
