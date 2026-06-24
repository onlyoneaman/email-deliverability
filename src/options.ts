import type { ValidateEmailOptions } from "./types.js";

export function applyImplicitChecks(options: ValidateEmailOptions): ValidateEmailOptions {
  return {
    ...options,
    checks: {
      dns: options.checks?.dns ?? true,
      typo: options.checks?.typo ?? Boolean(options.policy?.blockTypo),
      disposable: options.checks?.disposable ?? Boolean(options.policy?.blockDisposable),
      freeProvider: options.checks?.freeProvider ?? Boolean(options.policy?.requireBusinessEmail),
      smtp: options.checks?.smtp ?? Boolean(options.policy?.blockOnSmtpRejection),
    },
  };
}

export function mergeOptions(
  base: ValidateEmailOptions,
  override: ValidateEmailOptions,
): ValidateEmailOptions {
  return {
    ...base,
    ...override,
    checks: { ...base.checks, ...override.checks },
    syntax: { ...base.syntax, ...override.syntax },
    policy: { ...base.policy, ...override.policy },
    dns: { ...base.dns, ...override.dns },
    smtp: { ...base.smtp, ...override.smtp },
    typo: { ...base.typo, ...override.typo },
    datasets: { ...base.datasets, ...override.datasets },
    timeout: { ...base.timeout, ...override.timeout },
  };
}
