import { parseEmail as parseOnly } from "./parse.js";
import {
  createDomainSet,
  getDatasetInfo,
  getDisposableEmailDomains,
  getFreeEmailDomains,
  isDisposableEmailDomain,
  isFreeEmailDomain,
} from "./datasets.js";
import type { EmailValidationResult, ParseEmailOptions } from "./types.js";

export function parseEmail(
  input: string,
  options: ParseEmailOptions = {},
): EmailValidationResult {
  return parseOnly(input, {
    ...options,
    policy: {
      requirePublicInternetDomain: false,
      allowSpecialUseDomains: true,
      ...options.policy,
    },
  });
}

export function isEmailSyntaxValid(input: string, options: ParseEmailOptions = {}): boolean {
  return parseEmail(input, options).valid;
}

export {
  createDomainSet,
  getDatasetInfo,
  getDisposableEmailDomains,
  getFreeEmailDomains,
  isDisposableEmailDomain,
  isFreeEmailDomain,
};
