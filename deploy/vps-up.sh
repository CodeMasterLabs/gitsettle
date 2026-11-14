#!/usr/bin/env bash
# Run on the prepared VPS after reviewing and copying the tested source tree.
# Secrets stay in /opt/gitsettle/env and never enter Docker's build context.
set -euo pipefail

gitsettle_source="${GITSETTLE_SOURCE_DIR:-/opt/gitsettle/source}"
gitsettle_env="${GITSETTLE_ENV_FILE:-/opt/gitsettle/env/production.env}"

if [[ ! -f "$gitsettle_env" ]]; then
  echo "Create $gitsettle_env from deploy/vps.env.example before starting." >&2
  exit 1
fi
if [[ ! -f "$gitsettle_source/docker-compose.yml" ]]; then
  echo "Copy the tested repository to $gitsettle_source first." >&2
  exit 1
fi

cd "$gitsettle_source"
# --quiet validates without printing interpolated credentials to the terminal.
docker compose --env-file "$gitsettle_env" config --quiet
docker compose --env-file "$gitsettle_env" up --build --detach --wait
docker compose --env-file "$gitsettle_env" ps
