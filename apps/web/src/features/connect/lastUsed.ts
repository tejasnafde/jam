export function lastUsed(iso: string | null, now = Date.now()): string {
  if (!iso) return "never used";
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "used just now";
  if (minutes < 60) return `used ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `used ${hours} h ago`;
  return `used ${Math.round(hours / 24)} d ago`;
}
