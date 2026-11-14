import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { KeyPair, type KeyPairString } from 'near-api-js';
import { accountId, CliError, type CliArgs } from './args.ts';

/** A signing credential stays in memory and never appears in CLI result objects. */
export interface Credential { accountId: string; privateKey: KeyPairString }
export function loadCredential(args: CliArgs, env: Record<string, string | undefined> = process.env): Credential {
  let account: unknown = args.accountId; let key: unknown = env.GITSETTLE_PRIVATE_KEY;
  if (args.walletFile) {
    let fd: number | undefined;
    try {
      fd = openSync(args.walletFile, constants.O_RDONLY | constants.O_NOFOLLOW);
      const metadata = fstatSync(fd);
      if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600 || metadata.size > 16_384 || (process.getuid && metadata.uid !== process.getuid())) {
        throw new CliError('unsafe_wallet_file', 'Wallet file must be a regular file owned by this user, mode 0600, and at most 16 KiB.');
      }
      const value = JSON.parse(readFileSync(fd, 'utf8')) as Record<string, unknown>;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('shape');
      if ((value.accountId !== undefined && value.account_id !== undefined && value.accountId !== value.account_id)
        || (value.privateKey !== undefined && value.private_key !== undefined && value.privateKey !== value.private_key)) throw new Error('ambiguous');
      account = value.accountId ?? value.account_id; key = value.privateKey ?? value.private_key;
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError('wallet_file_invalid', 'Wallet file could not be read safely. Use a non-symlink 0600 JSON file with accountId and privateKey.');
    } finally { if (fd !== undefined) closeSync(fd); }
  }
  if (typeof account !== 'string' || typeof key !== 'string') throw new CliError('credential_required', 'Signing requires GITSETTLE_ACCOUNT_ID with GITSETTLE_PRIVATE_KEY, or a --wallet file.');
  const validated = accountId(account);
  if (args.accountId && validated !== args.accountId) throw new CliError('account_mismatch', 'The wallet file account does not match the selected --account.');
  try { if (!key.startsWith('ed25519:')) throw new Error('curve'); KeyPair.fromString(key as KeyPairString); }
  catch { throw new CliError('invalid_key', 'The configured signing key is not a valid Ed25519 key.'); }
  return { accountId: validated, privateKey: key as KeyPairString };
}
