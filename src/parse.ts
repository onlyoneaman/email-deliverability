import type {
  EmailIssue,
  EmailValidationResult,
  ParseEmailOptions,
  ParsedEmail,
} from "./types.js";
import { normalizeDomainName } from "./domain.js";
import { withMessages } from "./locale.js";
import { buildResult, emptyChecks, issue } from "./result.js";

export function parseEmail(input: string, options: ParseEmailOptions = {}): EmailValidationResult {
  const startedAt = performance.now();
  const syntaxIssues: EmailIssue[] = [];
  const extracted = extractAddrSpec(input, options, syntaxIssues);

  if (!extracted) {
    return syntaxFailure(input, syntaxIssues, startedAt, options.locale);
  }

  const atIndexes = findUnquotedAtIndexes(extracted);
  if (atIndexes.length === 0) {
    syntaxIssues.push(
      issue("email.syntax.missing_at", "syntax", true, { path: ["input"] }),
    );
    return syntaxFailure(input, syntaxIssues, startedAt, options.locale);
  }
  if (atIndexes.length > 1) {
    syntaxIssues.push(
      issue("email.syntax.too_many_at", "syntax", true, { path: ["input"] }),
    );
    return syntaxFailure(input, syntaxIssues, startedAt, options.locale);
  }

  const at = atIndexes[0]!;
  const local = extracted.slice(0, at);
  const domainInput = extracted.slice(at + 1);

  if (!local && !options.syntax?.allowEmptyLocal) {
    syntaxIssues.push(
      issue("email.syntax.missing_local", "syntax", true, { path: ["local"] }),
    );
  }
  if (!domainInput) {
    syntaxIssues.push(
      issue("email.syntax.missing_domain", "syntax", true, { path: ["domain"] }),
    );
  }

  const quotedLocal = local.startsWith('"') || local.endsWith('"');
  if (quotedLocal && !options.syntax?.allowQuotedLocal) {
    syntaxIssues.push(
      issue("email.syntax.quoted_local_not_allowed", "syntax", true, {
        path: ["local"],
      }),
    );
  } else if (!isValidLocal(local, Boolean(options.syntax?.allowQuotedLocal))) {
    syntaxIssues.push(
      issue("email.syntax.invalid_local", "syntax", true, { path: ["local"] }),
    );
  }
  if ((options.syntax?.allowSmtputf8 ?? true) === false && !isAscii(local)) {
    syntaxIssues.push(
      issue("email.syntax.smtputf8_not_allowed", "syntax", true, {
        path: ["local"],
      }),
    );
  }
  if (options.syntax?.unicodeSecurity === "strict" && !isAscii(`${local}@${domainInput}`)) {
    syntaxIssues.push(
      issue("email.syntax.unicode_security", "syntax", true, {
        path: ["input"],
      }),
    );
  }

  const domain = normalizeDomain(domainInput, options, syntaxIssues);
  const parsed = domain
    ? buildParsedEmail(local, domain.domain, domain.asciiDomain)
    : undefined;

  if (parsed && isTooLong(parsed)) {
    syntaxIssues.push(
      issue("email.syntax.too_long", "syntax", true, { path: ["input"] }),
    );
  }

  if (syntaxIssues.length > 0 || !parsed) {
    return syntaxFailure(input, syntaxIssues, startedAt, options.locale);
  }

  const checks = emptyChecks();
  checks.syntax = {
    status: "pass",
    reasons: [],
    durationMs: elapsed(startedAt),
  };
  return buildResult({
    input,
    parsed,
    checks,
    issues: [],
    options,
  });
}

function extractAddrSpec(
  input: string,
  options: ParseEmailOptions,
  issues: EmailIssue[],
): string | null {
  const value = input.trim();
  const lt = value.indexOf("<");
  const gt = value.lastIndexOf(">");
  if (lt !== -1 || gt !== -1) {
    if (!options.syntax?.allowDisplayName) {
      issues.push(
        issue("email.syntax.display_name_not_allowed", "syntax", true, {
          path: ["input"],
        }),
      );
      return null;
    }
    if (lt === -1 || gt === -1 || gt < lt || value.slice(gt + 1).trim() !== "") {
      issues.push(
        issue("email.syntax.invalid_display_name", "syntax", true, {
          path: ["input"],
        }),
      );
      return null;
    }
    return value.slice(lt + 1, gt).trim();
  }
  return value;
}

function findUnquotedAtIndexes(value: string): number[] {
  const indexes: number[] = [];
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (char === "@" && !quoted) indexes.push(index);
  }
  return indexes;
}

function isValidLocal(local: string, allowQuotedLocal: boolean): boolean {
  if (!local) return true;
  if (local.startsWith('"') || local.endsWith('"')) {
    if (!allowQuotedLocal) return false;
    if (!/^"(?:[^"\\\r\n]|\\.)*"$/.test(local)) return false;
    return true;
  }
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  for (const char of local) {
    const code = char.codePointAt(0)!;
    if (code <= 0x20 || code === 0x7f) return false;
    if (/\p{Separator}|\p{Control}|\p{Format}|\p{Private_Use}/u.test(char)) return false;
    if (/["(),:;<>@[\\\]]/.test(char)) return false;
  }
  return true;
}

function normalizeDomain(
  domainInput: string,
  options: ParseEmailOptions,
  issues: EmailIssue[],
): { domain: string; asciiDomain: string } | null {
  const domain = domainInput.trim().toLowerCase();
  if (!domain) return null;
  if (domain.startsWith("[") || domain.endsWith("]")) {
    if (options.syntax?.allowDomainLiteral || options.syntax?.mode === "rfc") {
      if (!isValidDomainLiteral(domain)) {
        issues.push(
          issue("email.syntax.invalid_domain_literal", "syntax", true, {
            path: ["domain"],
          }),
        );
        return null;
      }
      return { domain, asciiDomain: domain };
    }
    issues.push(
      issue("email.syntax.domain_literal_not_allowed", "syntax", true, {
        path: ["domain"],
      }),
    );
    return null;
  }
  if (domain.includes("..") || domain.startsWith(".") || domain.endsWith(".")) {
    issues.push(issue("email.syntax.invalid_domain", "syntax", true, { path: ["domain"] }));
    return null;
  }
  if (/[/:?#\s]/.test(domain)) {
    issues.push(issue("email.syntax.invalid_domain", "syntax", true, { path: ["domain"] }));
    return null;
  }
  const asciiDomain = normalizeDomainName(domain);
  if (!asciiDomain || asciiDomain.includes("_")) {
    issues.push(issue("email.syntax.invalid_domain", "syntax", true, { path: ["domain"] }));
    return null;
  }
  const labels = asciiDomain.split(".");
  if (labels.some((label) => !isValidDomainLabel(label))) {
    issues.push(issue("email.syntax.invalid_domain", "syntax", true, { path: ["domain"] }));
    return null;
  }
  return { domain, asciiDomain };
}

function isValidDomainLiteral(domain: string): boolean {
  if (!domain.startsWith("[") || !domain.endsWith("]")) return false;
  const literal = domain.slice(1, -1);
  if (literal.startsWith("IPv6:")) {
    return isValidIpv6(literal.slice(5));
  }
  return isValidIpv4(literal);
}

function isValidIpv4(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => {
      if (!/^\d+$/.test(part)) return false;
      if (part.length > 1 && part.startsWith("0")) return false;
      const number = Number(part);
      return number >= 0 && number <= 255;
    })
  );
}

function isValidIpv6(value: string): boolean {
  // URL parsing gives us a compact, platform-backed sanity check without adding deps.
  try {
    return new URL(`http://[${value}]`).hostname.length > 0;
  } catch {
    return false;
  }
}

function isValidDomainLabel(label: string): boolean {
  if (label.length === 0 || label.length > 63) return false;
  if (label.startsWith("-") || label.endsWith("-")) return false;
  return /^[a-z0-9-]+$/i.test(label);
}

function buildParsedEmail(local: string, domain: string, asciiDomain: string): ParsedEmail {
  const smtputf8 = !isAscii(local);
  return {
    normalized: `${local}@${domain}`,
    local,
    domain,
    asciiDomain,
    asciiEmail: smtputf8 ? null : `${local}@${asciiDomain}`,
    smtputf8,
  };
}

function syntaxFailure(
  input: string,
  issues: EmailIssue[],
  startedAt: number,
  locale?: string,
): EmailValidationResult {
  const checks = emptyChecks();
  checks.syntax = {
    status: "fail",
    reasons: issues.map((entry) => entry.code),
    durationMs: elapsed(startedAt),
  };
  return buildResult({
    input,
    checks,
    issues: withMessages(issues, locale),
  });
}

function isAscii(value: string): boolean {
  return /^[\x00-\x7F]*$/.test(value);
}

function isTooLong(parsed: ParsedEmail): boolean {
  const localBytes = new TextEncoder().encode(parsed.local).byteLength;
  const domainBytes = new TextEncoder().encode(parsed.asciiDomain).byteLength;
  const totalBytes = localBytes + 1 + domainBytes;
  return localBytes > 64 || domainBytes > 255 || totalBytes > 254;
}

function elapsed(startedAt: number): number {
  return Math.max(0, Math.round((performance.now() - startedAt) * 1000) / 1000);
}
