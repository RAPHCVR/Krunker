export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function sanitizeDisplayName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_ -]/g, '').trim().slice(0, 18) || 'Guest';
}
