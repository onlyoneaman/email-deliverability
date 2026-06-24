import { MemoryValidationCache } from "./cache.js";
import { checkDisposable, checkFreeProvider } from "./datasets.js";
import { checkDnsDeliverability } from "./dns.js";
import { withMessages } from "./locale.js";
import { parseEmail as parseOnly } from "./parse.js";
import { addAccountPolicyIssues, addRequiredCheckIssues } from "./policy.js";
import { buildResult } from "./result.js";
import { applyImplicitChecks, mergeOptions } from "./options.js";
import { parseEmail } from "./syntax-core.js";
import { checkSmtpProbe } from "./smtp.js";
import { checkTypo } from "./typo.js";
import type {
  EmailValidationCache,
  EmailValidationResult,
  ParseEmailOptions,
  ValidateEmailOptions,
} from "./types.js";

export async function validateEmail(
  input: string,
  options: ValidateEmailOptions = {},
): Promise<EmailValidationResult> {
  return validateEmailWithCache(input, options);
}

async function validateEmailWithCache(
  input: string,
  options: ValidateEmailOptions = {},
  sharedCache?: EmailValidationCache | false,
): Promise<EmailValidationResult> {
  const timeoutScope = withTotalTimeout(options);
  try {
    const effective = applyImplicitChecks(timeoutScope.options);
    const parsed = parseOnly(input, {
      ...effective,
      policy: {
        requirePublicInternetDomain: true,
        ...effective.policy,
      },
    });
    if (!parsed.valid || !parsed.parsed) return parsed;

    const checks = { ...parsed.checks };
    const issues = [...parsed.issues];
    addAccountPolicyIssues(parsed.parsed, effective, issues);

    if (effective.checks?.dns === false) {
      checks.dns = { status: "not_checked", reasons: ["disabled"] };
    } else {
      const dnsResult = await checkDnsDeliverability({
        parsed: parsed.parsed,
        options: effective,
        ...(sharedCache !== undefined ? { cache: sharedCache } : {}),
      });
      checks.dns = dnsResult.check;
      issues.push(...dnsResult.issues);
    }
    if (effective.checks?.typo !== true) {
      checks.typo = { status: "not_checked", reasons: ["disabled"] };
    } else {
      checks.typo = checkTypo(parsed.parsed, effective, checks.dns).check;
    }
    if (effective.checks?.disposable !== true) {
      checks.disposable = { status: "not_checked", reasons: ["disabled"] };
    } else {
      checks.disposable = checkDisposable(parsed.parsed, effective).check;
    }
    if (effective.checks?.freeProvider !== true) {
      checks.freeProvider = { status: "not_checked", reasons: ["disabled"] };
    } else {
      checks.freeProvider = checkFreeProvider(parsed.parsed, effective).check;
    }
    if (effective.checks?.smtp !== true) {
      checks.smtp = { status: "not_checked", reasons: ["disabled"] };
    } else {
      const smtpResult = await checkSmtpProbe({
        parsed: parsed.parsed,
        dns: checks.dns,
        options: effective,
      });
      checks.smtp = smtpResult.check;
      issues.push(...smtpResult.issues);
    }

    addRequiredCheckIssues(effective, checks, issues);

    return buildResult({
      input,
      parsed: parsed.parsed,
      checks,
      issues: withMessages(issues, effective.locale),
      options: effective,
    });
  } finally {
    timeoutScope.cleanup();
  }
}

function withTotalTimeout(options: ValidateEmailOptions): {
  options: ValidateEmailOptions;
  cleanup: () => void;
} {
  const totalMs = options.timeout?.totalMs;
  if (!totalMs) return { options, cleanup() {} };

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Validation timeout", "TimeoutError")),
    totalMs,
  );
  const abort = () => controller.abort(options.signal?.reason ?? new DOMException("Aborted", "AbortError"));
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener("abort", abort, { once: true });

  return {
    options: { ...options, signal: controller.signal },
    cleanup() {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    },
  };
}

export async function isValidEmail(
  input: string,
  options: ValidateEmailOptions = {},
): Promise<boolean> {
  return (await validateEmail(input, options)).valid;
}

export async function assertValidEmail(
  input: string,
  options: ValidateEmailOptions = {},
): Promise<EmailValidationResult> {
  const result = await validateEmail(input, options);
  if (!result.valid) {
    throw new EmailValidationError(result);
  }
  return result;
}

export class EmailValidationError extends Error {
  readonly result: EmailValidationResult;

  constructor(result: EmailValidationResult) {
    const primary = result.issues[0];
    super(primary ? `${primary.code}: ${primary.message}` : "email.validation.failed");
    this.name = "EmailValidationError";
    this.result = result;
  }
}

export async function checkDomainDeliverability(
  domain: string,
  options: ValidateEmailOptions = {},
): Promise<EmailValidationResult["checks"]["dns"]> {
  const result = await validateEmail(`postmaster@${domain}`, options);
  return result.checks.dns;
}

export async function checkEmailDomainDeliverability(
  email: string,
  options: ValidateEmailOptions = {},
): Promise<EmailValidationResult["checks"]["dns"]> {
  return (await validateEmail(email, options)).checks.dns;
}

export async function probeSmtp(
  email: string,
  options: ValidateEmailOptions = {},
): Promise<EmailValidationResult["checks"]["smtp"]> {
  const result = await validateEmail(email, {
    ...options,
    checks: { ...options.checks, smtp: true },
  });
  return result.checks.smtp;
}

export function createEmailValidator(defaultOptions: ValidateEmailOptions = {}) {
  const cache =
    defaultOptions.dns?.cache === false
      ? false
      : (defaultOptions.dns?.cache ?? new MemoryValidationCache());
  return {
    validateEmail(input: string, options: ValidateEmailOptions = {}) {
      const merged = mergeOptions(defaultOptions, options);
      const activeCache = merged.dns?.cache === false ? false : (merged.dns?.cache ?? cache);
      return validateEmailWithCache(input, merged, activeCache);
    },
    parseEmail(input: string, options: ParseEmailOptions = {}) {
      return parseEmail(input, mergeOptions(defaultOptions, options));
    },
  };
}
