# Maintenance Notes

These notes capture the product and engineering decisions behind the package.
The full original package contract lives in `docs/CONTRACT.md`; keep this file
as the short operational guide and update the contract when product decisions
change.

## Product Contract

`email-deliverability` should be honest about what it can prove:

- Syntax, normalization, DNS, datasets, and typo checks can provide deterministic
  signals.
- SMTP probing is diagnostic only. It cannot prove inbox placement or guaranteed
  mailbox existence.
- No remote verification API is used by default. DNS and SMTP use the caller's
  runtime/network unless a caller injects custom resolvers/connectors.

## Automation Boundary

Keep maintainer process in `AGENTS.md`, `docs/`, `scripts/`, and tests. Do not
change GitHub workflow files unless CI work is explicitly requested. Local
release gates must be useful without relying on GitHub Actions.

## Runtime Boundaries

- Main export: server-side Bun and Node API.
- `email-deliverability/syntax`: syntax and normalization only.
- `email-deliverability/browser`: browser-safe parsing and dataset helpers.
- Package format is ESM-only. CommonJS callers can use dynamic `import()`.

Browser-safe exports must not import `node:`, DNS, TCP, or TLS modules. Keep the
packaging test for this invariant.

## SMTP Security Rules

SMTP code is the highest-risk area because it opens network connections based on
user-controlled domains. Preserve these rules:

- Resolve MX/fallback hosts first, then connect to vetted IP addresses.
- Preserve the MX hostname only for SNI/STARTTLS identity.
- Block private, loopback, link-local, documentation, multicast, ULA, 6to4,
  Teredo, CGNAT, NAT64, and IPv4-mapped private/reserved targets by default.
- Keep CRLF injection checks on sender, HELO, recipient, and catch-all probes.
- Keep SMTP probing opt-in for `validateEmail`; direct `probeSmtp()` is always
  explicit.
- Treat SMTP accepted responses as a signal, not proof of mailbox existence.
- When SMTP is enabled, keep catch-all detection on by default after a target
  recipient is accepted. `smtp.detectCatchAll: false` is the low-level opt-out.

Any change to SMTP targeting or address blocking needs tests for IPv4 and IPv6.

## DNS Rules

- MX records are preferred.
- RFC Null MX is undeliverable.
- If MX is absent, A/AAAA fallback is allowed.
- `requireDnsDeliverable: false` should report hard DNS facts without blocking.
- Timeouts and abort signals should produce structured check states.
- Shared validators should keep DNS cache bounded.

## Dataset Rules

Built-in datasets come from:

- `free-email-domains`
- `disposable-email-domains-js`

Disposable domains take precedence. The built-in free-provider dataset must
exclude disposable domains so a domain does not simultaneously ship as both
`free_provider` and `disposable`.

Run after any dataset change:

```sh
bun run datasets:verify
bun test tests/datasets.test.ts
```

Keep `NOTICE` and generated `DATASET_SOURCE_INFO` current whenever sources,
versions, counts, or licenses change.

## Localization

Supported locales currently include `en`, `es`, `fr`, `de`, `pt-BR`, `hi`, `ja`,
and `zh-CN`. Every stable message code must exist in every locale. Avoid exposing
internal i18n keys as the public message contract; callers should use structured
`code`, `severity`, `check`, and `path` fields.

## Package Budget

The target packed size is under 100 KiB (102,400 bytes). The generated domain data is the main
size driver, so avoid adding runtime dependencies or bundled duplicate datasets.

If package size grows, first check:

- generated dataset duplication
- accidental inclusion of source/tests/scripts/docs in the npm tarball
- locale bloat
- new runtime dependencies

## Issue Triage

Good candidates:

- parser compatibility gaps with real email forms
- DNS edge cases and timeout behavior
- safer SMTP diagnostics
- runtime boundary bugs
- false positives/negatives in dataset classification
- localization improvements

Be careful with:

- requests to guarantee mailbox existence
- default SMTP probing
- remote verification APIs
- permissive network behavior that weakens SSRF protections
- adding large datasets without a size and licensing review

## Result Contract

Use `status`, `reason`, and `recommendation` as the simple product-facing result.
Keep detailed evidence in `checks`, `issues`, and `decision.blockedBy`.

Avoid changes that force callers to interpret SMTP internals before they can
decide whether to accept, reject, or verify an address.
