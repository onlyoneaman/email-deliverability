import type { DnsDeliverabilityCheck, ParsedEmail, TypoCheck, ValidateEmailOptions } from "./types.js";

const MAX_DISTANCE = 2;
const DEFAULT_TYPO_DOMAINS = [
  "aol.com",
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "mail.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "yahoo.com",
] as const;

export function checkTypo(
  parsed: ParsedEmail,
  options: ValidateEmailOptions,
  dns: DnsDeliverabilityCheck,
): { check: TypoCheck } {
  if (dns.deliverability === "deliverable" && !options.typo?.suggestEvenWhenDeliverable) {
    return { check: { status: "pass", reasons: ["dns_deliverable"] } };
  }

  const suggestion = closestDomain(parsed.asciiDomain, options);
  if (!suggestion) {
    return { check: { status: "pass", reasons: [] } };
  }

  return {
    check: {
      status: "warning",
      reasons: ["possible_typo"],
      suggestion: `${parsed.local}@${suggestion}`,
      confidence: confidence(parsed.asciiDomain, suggestion),
    },
  };
}

function closestDomain(domain: string, options: ValidateEmailOptions): string | null {
  let best: { domain: string; distance: number } | undefined;
  for (const candidate of commonDomains(options)) {
    if (candidate === domain) return null;
    const distance = boundedLevenshtein(domain, candidate, MAX_DISTANCE);
    if (distance === null) continue;
    if (
      !best ||
      distance < best.distance ||
      (distance === best.distance && candidate.length < best.domain.length)
    ) {
      best = { domain: candidate, distance };
    }
  }
  return best?.domain ?? null;
}

function commonDomains(options: ValidateEmailOptions): Set<string> {
  return new Set(
    [
      ...DEFAULT_TYPO_DOMAINS,
      ...(options.datasets?.commonDomains ?? []),
      ...(options.typo?.commonDomains ?? []),
    ].map((domain) => domain.trim().toLowerCase()).filter(Boolean),
  );
}

function confidence(domain: string, suggestion: string): number {
  const distance = boundedLevenshtein(domain, suggestion, MAX_DISTANCE) ?? MAX_DISTANCE;
  return Math.max(0.5, Math.round((1 - distance / Math.max(domain.length, suggestion.length)) * 100) / 100);
}

function boundedLevenshtein(left: string, right: string, maxDistance: number): number | null {
  if (Math.abs(left.length - right.length) > maxDistance) return null;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowBest = current[0]!;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const value = Math.min(
        previous[rightIndex]! + 1,
        current[rightIndex - 1]! + 1,
        previous[rightIndex - 1]! + substitution,
      );
      current[rightIndex] = value;
      rowBest = Math.min(rowBest, value);
    }
    if (rowBest > maxDistance) return null;
    previous = current;
  }
  const distance = previous[right.length]!;
  return distance <= maxDistance ? distance : null;
}
