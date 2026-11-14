import { CliError, MUTATIONS, parseArgs } from './args.ts';
import { NearCliPort } from './client.ts';
import { execute } from './commands.ts';
import { loadCredential } from './credentials.ts';
import { render, terminalText } from './output.ts';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await execute(args, { port: new NearCliPort(args, Boolean(args.apiUrl) && !MUTATIONS.has(args.command)), credential: () => loadCredential(args) });
  process.stdout.write(render(result, args.json) + '\n');
  if (result.status === 'failed') process.exitCode = 1;
  if (result.status === 'pending') process.exitCode = 3;
}
main().catch(error => {
  // Never expose raw SDK/RPC/provider errors: they may contain credentials or payloads.
  const safe = error instanceof CliError ? error : new CliError('request_failed', 'The request failed. Check the network, selected account and contract configuration.');
  const result = { error: { code: safe.code, message: safe.message } };
  process.stderr.write(process.argv.includes('--json') ? JSON.stringify(result) + '\n' : terminalText(`${safe.code}: ${safe.message}`) + '\n');
  process.exitCode = safe.exitCode;
});
