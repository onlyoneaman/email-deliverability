export type * from "./types.js";

export {
  createDomainSet,
  getDatasetInfo,
  getDisposableEmailDomains,
  getFreeEmailDomains,
  isDisposableEmailDomain,
  isEmailSyntaxValid,
  isFreeEmailDomain,
  parseEmail,
} from "./syntax-core.js";

export {
  EmailValidationError,
  assertValidEmail,
  checkDomainDeliverability,
  checkEmailDomainDeliverability,
  createEmailValidator,
  isValidEmail,
  probeSmtp,
  validateEmail,
} from "./validator.js";

export { validateEmails } from "./batch.js";
