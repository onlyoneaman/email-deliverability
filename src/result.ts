import type {
  EmailIssue,
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
  return {
    input: args.input,
    ...(args.parsed ? { parsed: args.parsed } : {}),
    checks,
    issues: args.issues,
    decision: { accepted, blockedBy },
    valid: accepted,
  };
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
