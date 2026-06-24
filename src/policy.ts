import { issue } from "./result.js";
import type { EmailIssue, EmailValidationResult, ParsedEmail, ValidateEmailOptions } from "./types.js";

const SPECIAL_USE_TLDS = new Set(["localhost", "local", "test", "invalid", "example"]);

export function addAccountPolicyIssues(
  parsed: ParsedEmail,
  options: ValidateEmailOptions,
  issues: EmailIssue[],
): void {
  const requirePublic = options.policy?.requirePublicInternetDomain ?? true;
  if (requirePublic && !parsed.asciiDomain.includes(".")) {
    issues.push(
      issue("email.policy.public_domain_required", "policy", true, {
        path: ["domain"],
      }),
    );
  }

  const allowSpecial = options.policy?.allowSpecialUseDomains ?? false;
  const tld = parsed.asciiDomain.split(".").at(-1) ?? "";
  if (!allowSpecial && SPECIAL_USE_TLDS.has(tld)) {
    issues.push(
      issue("email.policy.special_use_domain", "policy", true, {
        path: ["domain"],
        params: { domain: parsed.domain },
      }),
    );
  }
}

export function addRequiredCheckIssues(
  options: ValidateEmailOptions,
  checks: EmailValidationResult["checks"],
  issues: EmailValidationResult["issues"],
): void {
  if (
    options.policy?.requireDnsDeliverable &&
    checks.dns.status === "not_checked"
  ) {
    issues.push(issue("email.dns.not_checked", "dns", true, { path: ["checks", "dns"] }));
  }
  if (options.policy?.blockTypo && checks.typo.status === "not_checked") {
    issues.push(issue("email.typo.not_checked", "typo", true, { path: ["checks", "typo"] }));
  }
  if (options.policy?.blockTypo && checks.typo.status === "warning" && checks.typo.suggestion) {
    issues.push(issue("email.typo.blocked", "typo", true, { path: ["checks", "typo"] }));
  }
  if (options.policy?.blockDisposable && checks.disposable.status === "not_checked") {
    issues.push(
      issue("email.disposable.not_checked", "disposable", true, {
        path: ["checks", "disposable"],
      }),
    );
  }
  if (
    options.policy?.blockDisposable &&
    checks.disposable.status === "warning" &&
    checks.disposable.disposable
  ) {
    issues.push(
      issue("email.disposable.blocked", "disposable", true, {
        path: ["checks", "disposable"],
      }),
    );
  }
  if (options.policy?.requireBusinessEmail && checks.freeProvider.status === "not_checked") {
    issues.push(
      issue("email.free_provider.not_checked", "freeProvider", true, {
        path: ["checks", "freeProvider"],
      }),
    );
  }
  if (
    options.policy?.requireBusinessEmail &&
    checks.freeProvider.status === "warning" &&
    checks.freeProvider.freeProvider
  ) {
    issues.push(
      issue("email.free_provider.blocked", "freeProvider", true, {
        path: ["checks", "freeProvider"],
      }),
    );
  }
  if (options.policy?.blockOnSmtpRejection && checks.smtp.status === "not_checked") {
    issues.push(issue("email.smtp.not_checked", "smtp", true, { path: ["checks", "smtp"] }));
  }
  if (options.policy?.blockOnSmtpRejection && checks.smtp.valid === false) {
    issues.push(issue("email.smtp.rejected", "smtp", true, { path: ["checks", "smtp"] }));
  }
}
