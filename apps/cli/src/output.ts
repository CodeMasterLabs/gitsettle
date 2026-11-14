import { formatNear, isExpired } from '@gitsettle/shared/format';
import type { Bounty, Contributor } from '@gitsettle/shared/types';

/** Escape terminal control sequences in any external or operator-controlled display text. */
export function terminalText(value: string): string { return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ''); }
export function render(result: Record<string, unknown>, json: boolean): string {
  if (json) return JSON.stringify(result, null, 2);
  if (typeof result.help === 'string') return result.help;
  if (typeof result.version === 'string') return result.version;
  const heading = `GitSettle · testnet · ${result.contractId}`;
  if (Array.isArray(result.bounties)) {
    const rows = result.bounties as Bounty[];
    return terminalText(`${heading}\nID\tTYPE\tLOCALE\tSTATUS\tREWARD NEAR\tREPOSITORY\n${rows.map(b => `${b.id}\t${b.bounty_type}\t${b.target_locale || '—'}\t${isExpired(b) ? 'Expired' : b.status}\t${formatNear(b.reward)}\t${b.repo}`).join('\n') || 'No bounties match these filters.'}`);
  }
  if (Array.isArray(result.entries)) return terminalText(`${heading}\nRANK\tACCOUNT\tPOINTS\tMERGED\tEARNED NEAR\n${(result.entries as Contributor[]).map((entry, index) => `${index + 1}\t${entry.account_id}\t${entry.points}\t${entry.merged_count}\t${formatNear(entry.total_earned)}`).join('\n') || 'No contributors have received a payout yet.'}`);
  if (result.profile) { const p = result.profile as Contributor; return terminalText(`${heading}\n${p.account_id}\nPoints: ${p.points}\nMerged: ${p.merged_count}\nEarned: ${formatNear(p.total_earned)} NEAR`); }
  return terminalText(`${heading}\n${JSON.stringify(result, null, 2)}`);
}
