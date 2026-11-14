/** Safe, intentional errors are the only internal details returned over HTTP. */
export class CommunityError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}
export function badInput(message: string): never { throw new CommunityError(400, 'invalid_input', message); }
export function recordInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) badInput('A JSON object is required.');
  return value as Record<string, unknown>;
}
export function boundedText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string') badInput(`${name} is required.`);
  const text = value.trim();
  if (!text || text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) badInput(`${name} must contain 1–${max} characters without control characters.`);
  return text;
}
