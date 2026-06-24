# Changelog

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
