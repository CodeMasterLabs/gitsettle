const ONE_NEAR = 10n ** 24n;

/** Parse an exact decimal amount without floating point or exponential notation. */
export function parseNear(input: string): string {
  if (!/^(0|[1-9]\d*)(\.\d{1,24})?$/.test(input.trim())) throw new Error('Enter a NEAR amount with at most 24 decimal places.');
  const [whole, fraction = ''] = input.trim().split('.');
  return (BigInt(whole) * ONE_NEAR + BigInt(fraction.padEnd(24, '0'))).toString();
}

/** Display exact useful precision, with at least two decimals for an aligned financial column. */
export function formatNear(yocto: string): string {
  const value = BigInt(yocto);
  const whole = value / ONE_NEAR;
  const fraction = (value % ONE_NEAR).toString().padStart(24, '0').replace(/0+$/, '');
  return `${whole.toLocaleString('en-US')}.${fraction.padEnd(2, '0')}`;
}

export function isExpired(bounty: { status: string; deadline: number }, now = Date.now() / 1000): boolean {
  return ['Open', 'Claimed', 'Rejected'].includes(bounty.status) && bounty.deadline <= now;
}
