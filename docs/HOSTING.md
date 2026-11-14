# Hosted GitSettle demo

Public URL: **https://gitsettle.89.167.109.196.sslip.io**

VPS: `89.167.109.196`, Ubuntu 26.04.1 LTS. The `sslip.io` hostname resolves to
that IP without requiring a separately purchased domain. Keep this VPS and the
application available through judging on 2026-11-18, ideally through 2026-11-25.
The hostname depends on the external sslip.io DNS service.

## HTTPS checkpoint

Verified on 2026-11-14:

- Public DNS resolves `gitsettle.89.167.109.196.sslip.io` to `89.167.109.196`.
- Caddy **2.11.9** is installed from the official stable Cloudsmith APT repository.
- `caddy.service` is enabled at boot and active. Its configuration validates.
- HTTP returns **308** to HTTPS. A public HTTPS request passes certificate
  verification and reaches Caddy.
- Let's Encrypt issued the certificate for the exact hostname. Initial validity:
  2026-11-14 05:38:38 UTC through 2027-02-12 05:38:37 UTC. Caddy renews it
  automatically while DNS and public challenge ports remain available.

At this infrastructure checkpoint the HTTPS response is **502**, because the
application has not yet been started on `127.0.0.1:3000`. This proves working DNS,
TLS and proxy reachability; it is **not an application availability claim**. Once
the application is deployed, verify the work queue and `/api/health` as described
below. Application deployment evidence should replace this pending checkpoint.

## Reverse proxy configuration

Only the new GitSettle site was configured. The packaged default was preserved
as `/etc/caddy/Caddyfile.packaged-default`. Active `/etc/caddy/Caddyfile`:

```caddyfile
# GitSettle testnet demo. Application port stays on loopback.
gitsettle.89.167.109.196.sslip.io {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

The application deployment must set `APP_BIND=127.0.0.1` and `APP_PORT=3000` so
the Node port is only accessible through the local proxy. Public web traffic uses
TCP 80/443; HTTP/3 additionally uses UDP 443. Caddy's admin API remains local.
The verifier has no public listening port.

Caddy's system service owns its ACME account/certificate data under its private
service directory in `/var/lib/caddy`. Do not copy that directory, wallet keys,
or environment files into the repository or application image. The proxy does
not serve a filesystem directory; every site request goes to the web application.

## Deployment and operations

The prepared host layout is `/opt/gitsettle/source`, `/opt/gitsettle/data`, and
`/opt/gitsettle/env`. See [self-hosting](SELF_HOST.md) for Compose/environment and
persistent-data instructions. The private production environment must include
the loopback binding above. HTTPS setup did not transfer application source or
private keys to the VPS.

After starting the application:

```sh
curl --fail --silent --show-error https://gitsettle.89.167.109.196.sslip.io/api/health
curl --fail --silent --show-error --output /dev/null https://gitsettle.89.167.109.196.sslip.io/
```

On the VPS, inspect and reload the proxy with:

```sh
systemctl status caddy --no-pager
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
journalctl -u caddy --since '10 minutes ago' --no-pager
```

Use reload after a validated configuration edit to preserve active connections.
For a 502, first check that the application is healthy at
`http://127.0.0.1:3000/api/health`, then check Compose container logs. A certificate
failure instead calls for DNS, public 80/443 reachability and Caddy ACME logs.
Moving to an owned domain requires updating DNS and the Caddy site hostname, then
validating/reloading; application wallet return URLs should use the new origin.

## Sources verified before installation

- [Official Caddy Debian/Ubuntu installation](https://caddyserver.com/docs/install#debian-ubuntu-raspbian)
- [Caddy reverse-proxy quick start](https://caddyserver.com/docs/quick-starts/reverse-proxy)
- [Automatic HTTPS requirements and renewal](https://caddyserver.com/docs/automatic-https)

The stable repository package candidate was checked with `apt-cache policy caddy`
before installation; `caddy version` confirmed the installed version. Public
certificate verification used normal `curl` and `openssl s_client` validation,
without `--insecure` or disabled TLS checks.
