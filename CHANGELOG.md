# Changelog

## 0.2.0 - 2026-06-24

- Added top-level `status`, `reason`, and `recommendation` fields to `validateEmail()` results for simpler product decisions.
- Kept detailed evidence in `checks`, `issues`, and `decision.blockedBy`, while documenting that `valid`/`decision.accepted` reflect configured blocking policy.
- Changed SMTP probing so catch-all detection runs by default when SMTP is enabled and the target recipient is accepted; `smtp.detectCatchAll: false` is the explicit opt-out.
- Surfaced diagnostic SMTP mailbox rejection, catch-all, timeout, blocked-network, and invalid-option states in the top-level summary without pretending SMTP proves mailbox existence.
- Updated contracts, README, maintainer notes, and tests for the simplified result contract.

## 0.1.1 - 2026-06-24

- Expanded the npm README with product-flow examples, runtime boundaries, comparison guidance, SMTP caveats, localization notes, and package-size proof.
- Documented the ESM-only package format and CommonJS dynamic import expectation.
- Kept the package boundary strict: no default SMTP probing, no mailbox-existence claims, no hosted API dependency, and no new runtime dependencies.

## 0.1.0 - 2026-06-24

- Initial public release.
- Added email syntax parsing and normalization.
- Added DNS deliverability checks with MX, Null MX, A/AAAA fallback, resolver injection, timeout handling, and LRU/TTL cache support.
- Added free-provider and disposable-domain datasets with source provenance.
- Added conservative typo suggestions.
- Added opt-in SMTP diagnostics with safer target resolution, STARTTLS handling, catch-all detection, and batch concurrency controls.
- Added browser-safe and syntax-only subpath exports.
- Added localized messages for supported locales.
