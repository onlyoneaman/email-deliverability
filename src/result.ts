import type {
  EmailIssue,
  EmailReason,
  EmailRecommendation,
  EmailStatus,
  EmailValidationResult,
  ParsedEmail,
  ValidateEmailOptions,
} from "./types.js";

export function emptyChecks(): EmailValidationResult["checks"] {
  return {
    syntax: { status: "fail", reasons: [] },
    dns: { status: "not_checked", reasons: [] },
    typo: { status: "not_checked", reasons: [] },
    disposable: { status: "not_checked", reasons: [] },
    freeProvider: { status: "not_checked", reasons: [] },
    smtp: { status: "not_checked", reasons: [] },
  };
}

export function issue(
  code: string,
  stage: EmailIssue["stage"],
  affectsValidity: boolean,
  extra: Partial<Omit<EmailIssue, "code" | "stage" | "affectsValidity" | "message">> = {},
): EmailIssue {
  return {
    code,
    stage,
    severity: affectsValidity ? "error" : "warning",
    message: "",
    affectsValidity,
    ...extra,
  };
}

export function buildResult(args: {
  input: string;
  parsed?: ParsedEmail;
  issues: EmailIssue[];
  checks?: Partial<EmailValidationResult["checks"]>;
  options?: ValidateEmailOptions;
}): EmailValidationResult {
  const checks = { ...emptyChecks(), ...args.checks };
  const blockedBy = args.issues
    .filter((entry) => entry.affectsValidity)
    .map((entry) => ({
      policy: policyForIssue(entry.code),
      issueCode: entry.code,
    }));
  const accepted = blockedBy.length === 0;
  const summary = summarize({
    checks,
    issues: args.issues,
  });
  return {
    input: args.input,
    ...(args.parsed ? { parsed: args.parsed } : {}),
    checks,
    issues: args.issues,
    decision: { accepted, blockedBy },
    valid: accepted,
    ...summary,
  };
}

function summarize(args: {
  checks: EmailValidationResult["checks"];
  issues: EmailIssue[];
}): {
  status: EmailStatus;
  reason: EmailReason;
  recommendation: EmailRecommendation;
} {
  const blocking = args.issues.find((entry) => entry.affectsValidity);
  if (blocking) return summarizeBlockingIssue(blocking);

  if (args.checks.smtp.reasons.includes("mailbox_rejected")) {
    return { status: "undeliverable", reason: "mailbox_rejected", recommendation: "reject" };
  }
  if (args.checks.smtp.reasons.includes("catch_all")) {
    return { status: "risky", reason: "catch_all", recommendation: "verify" };
  }
  if (args.checks.smtp.status === "timeout") {
    return { status: "unknown", reason: "smtp_timeout", recommendation: "verify" };
  }
  if (args.checks.smtp.status === "error") {
    return { status: "unknown", reason: "smtp_error", recommendation: "verify" };
  }
  if (args.checks.smtp.reasons.includes("network_blocked")) {
    return { status: "unknown", reason: "smtp_blocked", recommendation: "verify" };
  }
  if (args.checks.smtp.reasons.includes("temporary_failure")) {
    return { status: "unknown", reason: "smtp_tempfail", recommendation: "verify" };
  }
  if (args.checks.smtp.status === "fail") {
    return { status: "unknown", reason: "smtp_error", recommendation: "verify" };
  }
  if (args.checks.smtp.status === "unknown") {
    return { status: "unknown", reason: "inconclusive", recommendation: "verify" };
  }
  if (args.checks.dns.status === "timeout" || args.checks.dns.status === "error") {
    return { status: "unknown", reason: "inconclusive", recommendation: "verify" };
  }
  if (args.checks.typo.status === "warning") {
    return { status: "risky", reason: "typo", recommendation: "verify" };
  }
  if (args.checks.disposable.status === "warning") {
    return { status: "risky", reason: "disposable", recommendation: "verify" };
  }
  if (args.checks.freeProvider.status === "warning") {
    return { status: "risky", reason: "free_provider", recommendation: "verify" };
  }
  if (args.checks.dns.reasons.includes("domain_not_found")) {
    return { status: "undeliverable", reason: "domain_not_found", recommendation: "reject" };
  }
  if (args.checks.dns.deliverability === "undeliverable") {
    return { status: "undeliverable", reason: "no_mail_server", recommendation: "reject" };
  }
  if (args.checks.dns.deliverability === "risky") {
    return { status: "risky", reason: "inconclusive", recommendation: "verify" };
  }
  if (args.checks.dns.status === "not_checked") {
    return { status: "unknown", reason: "inconclusive", recommendation: "accept" };
  }
  return { status: "deliverable", reason: "accepted", recommendation: "accept" };
}

function summarizeBlockingIssue(issue: EmailIssue): {
  status: EmailStatus;
  reason: EmailReason;
  recommendation: EmailRecommendation;
} {
  if (issue.code.startsWith("email.syntax.")) {
    return { status: "undeliverable", reason: "invalid_syntax", recommendation: "reject" };
  }
  switch (issue.code) {
    case "email.policy.public_domain_required":
    case "email.policy.special_use_domain":
      return { status: "undeliverable", reason: "not_public_domain", recommendation: "reject" };
    case "email.dns.domain_not_found":
      return { status: "undeliverable", reason: "domain_not_found", recommendation: "reject" };
    case "email.dns.null_mx":
    case "email.dns.no_mail_records":
    case "email.dns.malformed_null_mx":
      return { status: "undeliverable", reason: "no_mail_server", recommendation: "reject" };
    case "email.dns.timeout":
    case "email.dns.error":
    case "email.dns.not_checked":
      return { status: "unknown", reason: "inconclusive", recommendation: "verify" };
    case "email.smtp.rejected":
      return { status: "undeliverable", reason: "mailbox_rejected", recommendation: "reject" };
    case "email.smtp.not_checked":
      return { status: "unknown", reason: "inconclusive", recommendation: "verify" };
    case "email.disposable.blocked":
    case "email.disposable.not_checked":
      return { status: "risky", reason: "disposable", recommendation: "reject" };
    case "email.free_provider.blocked":
    case "email.free_provider.not_checked":
      return { status: "risky", reason: "free_provider", recommendation: "reject" };
    case "email.typo.blocked":
    case "email.typo.not_checked":
      return { status: "risky", reason: "typo", recommendation: "reject" };
    default:
      return { status: "unknown", reason: "inconclusive", recommendation: "verify" };
  }
}

const ISSUE_POLICY: Record<
  string,
  EmailValidationResult["decision"]["blockedBy"][number]["policy"]
> = {
  "email.policy.public_domain_required": "requirePublicInternetDomain",
  "email.policy.special_use_domain": "allowSpecialUseDomains",
  "email.dns.not_checked": "dns",
  "email.dns.null_mx": "dns",
  "email.dns.no_mail_records": "dns",
  "email.dns.domain_not_found": "dns",
  "email.dns.timeout": "dns",
  "email.dns.error": "dns",
  "email.dns.malformed_null_mx": "dns",
  "email.typo.not_checked": "blockTypo",
  "email.typo.blocked": "blockTypo",
  "email.disposable.not_checked": "blockDisposable",
  "email.disposable.blocked": "blockDisposable",
  "email.free_provider.not_checked": "requireBusinessEmail",
  "email.free_provider.blocked": "requireBusinessEmail",
  "email.smtp.not_checked": "blockOnSmtpRejection",
  "email.smtp.rejected": "blockOnSmtpRejection",
};

function policyForIssue(
  code: string,
): EmailValidationResult["decision"]["blockedBy"][number]["policy"] {
  if (code.startsWith("email.syntax.")) return "syntax";
  const policy = ISSUE_POLICY[code];
  if (!policy) {
    throw new Error(`Issue code is missing policy mapping: ${code}`);
  }
  return policy;
}
