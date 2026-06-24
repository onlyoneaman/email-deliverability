export function normalizeDomainName(domain: string): string {
  const value = domain.trim().toLowerCase();
  if (!value) return "";
  try {
    return new URL(`http://${value}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}
