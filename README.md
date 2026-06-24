# email-deliverability

Honest email validation for Node.js and Bun: syntax, normalization, DNS MX
checks, disposable/free-provider signals, typo hints, and optional SMTP
diagnostics without pretending SMTP proves mailbox existence.

## Install

```sh
bun add email-deliverability
# or
npm install email-deliverability
```

Requirements:

- Bun or Node.js `>=22`
- ESM imports. CommonJS projects can use dynamic `import()`.
- No required runtime dependencies.
- No API key, hosted verifier, quota, or remote email-verification service.

## Quick Start

```ts
import { validateEmail } from "email-deliverability";

const result = await validateEmail("User+tag@Example.COM");

if (result.decision.accepted && result.parsed) {
  console.log(result.parsed.normalized);
} else {
  console.log(result.issues);
}
```

`valid` is a convenience alias for `decision.accepted`. For product flows, use
the structured `checks`, `issues`, and `decision.blockedBy` fields instead of
parsing human-readable messages.

## What This Checks

- Syntax and normalization, including IDN domains.
- DNS mail deliverability through MX records, Null MX, and A/AAAA fallback.
- Optional disposable-domain and free-provider signals.
- Optional conservative typo suggestions.
- Optional SMTP diagnostics for operators who understand the tradeoffs.

## What This Cannot Prove

This package does not prove inbox placement, spam-folder placement, sender
reputation, guaranteed mailbox existence, or that a message will not bounce.
SMTP probing is unreliable: many providers tarp it, hide recipient status, block
port 25, greylist, use catch-all domains, or return false answers to reduce
abuse.

## Common Flows

Signup/account creation:

```ts
await validateEmail(email, {
  checks: {
    dns: true,
    typo: true,
    disposable: true,
    freeProvider: true,
  },
  policy: {
    blockDisposable: true,
  },
});
```

Login:

```ts
await validateEmail(email, {
  checks: { dns: false },
});
```

Work email collection:

```ts
await validateEmail(email, {
  checks: { dns: true, freeProvider: true, disposable: true },
  policy: { requireBusinessEmail: true, blockDisposable: true },
});
```

DNS-only deliverability:

```ts
import { checkEmailDomainDeliverability } from "email-deliverability";

const dns = await checkEmailDomainDeliverability("user@example.com");

if (dns.deliverability === "deliverable") {
  console.log("Domain is configured to receive mail.");
}
```

Syntax-only validation:

```ts
import { isEmailSyntaxValid, parseEmail } from "email-deliverability/syntax";

isEmailSyntaxValid("User@例え.テスト"); // true

const parsed = parseEmail("Jane <jane@example.com>", {
  syntax: { allowDisplayName: true },
});
```

Browser-safe helpers:

```ts
import {
  isDisposableEmailDomain,
  isFreeEmailDomain,
  parseEmail,
} from "email-deliverability/browser";
```

The browser export does not import DNS, TCP, or TLS modules.

## SMTP Diagnostics

SMTP probing is opt-in and diagnostic. It should not be used as a default signup
gate unless you fully understand the operational cost and false answers.

```ts
await validateEmail(email, {
  checks: { smtp: true },
  smtp: {
    sender: "probe@example.com",
    heloName: "example.com",
    timeoutMs: 5_000,
  },
});
```

SMTP rejection affects `decision.accepted` only when you explicitly ask for it:

```ts
await validateEmail(email, {
  checks: { smtp: true },
  policy: { blockOnSmtpRejection: true },
});
```

The SMTP implementation resolves MX/fallback hosts first, connects to vetted IPs,
blocks private/reserved networks by default, supports STARTTLS, and treats
catch-all/temporary/timeout states as inconclusive.

## Batch Validation

```ts
import { validateEmails } from "email-deliverability";

const batch = await validateEmails(emails, {
  checks: { dns: true, disposable: true },
  policy: { blockDisposable: true },
  batch: {
    concurrency: 20,
    dnsConcurrency: 8,
    smtpConcurrency: 2,
  },
});

console.log(batch.summary);
```

Batch validation preserves result order and avoids unbounded DNS/SMTP fan-out.

## Custom Resolver And Cache

```ts
import { createEmailValidator } from "email-deliverability";

const validator = createEmailValidator({
  checks: { dns: true },
  dns: {
    timeoutMs: 2_000,
    resolver: myResolver,
    cache: myCache,
  },
});

await validator.validateEmail("user@example.com");
```

Resolvers and caches are injectable so tests, serverless apps, and larger
systems can control timeouts, retries, and DNS behavior.

## Result Shape

Every result separates facts from policy:

```ts
const result = await validateEmail("user@gmail.com", {
  checks: { dns: true, freeProvider: true },
});

result.checks.syntax.status; // "pass" | "fail"
result.checks.dns.deliverability; // "deliverable" | "undeliverable" | ...
result.checks.freeProvider.freeProvider; // boolean | undefined
result.issues; // stable codes, stages, messages, paths
result.decision.blockedBy; // policy decisions only
```

Machine-readable `issue.code`, `issue.stage`, `issue.path`, and
`issue.params` are the integration surface. `issue.message` is display text.

Built-in message locales: `en`, `es`, `fr`, `de`, `pt-BR`, `hi`, `ja`,
`zh-CN`.

```ts
await validateEmail("bad", { locale: "es" });
```

## Runtime Boundaries

`email-deliverability` has no required runtime dependencies and does not call a
remote verification API. DNS and SMTP are server-side only.

- `email-deliverability`: full Node.js/Bun server API.
- `email-deliverability/syntax`: parsing and normalization only.
- `email-deliverability/browser`: browser-safe parsing and dataset helpers.
- The package is ESM-only. CommonJS projects should use dynamic `import()`.

Browsers, edge runtimes, serverless platforms, containers, and cloud hosts may
block DNS APIs or outbound port 25. Disable DNS/SMTP checks when they do not fit
your runtime.

## Why Not Just Regex?

Regex can catch obvious typos, but it does not normalize IDN domains, handle Null
MX, separate syntax from policy, expose structured failure reasons, or tell you
whether a domain is configured to receive mail.

## Why Not `validator.js`?

`validator.js` is useful for syntax-style checks. This package is for product
flows that also need normalization, DNS deliverability, dataset signals,
localized structured issues, and explicit runtime boundaries.

## Why Not `deep-email-validator`?

`deep-email-validator` popularized DNS/SMTP checks in Node. This package keeps
SMTP explicitly diagnostic, separates typo/disposable/free-provider signals from
policy decisions, and documents serverless and port-25 limitations directly.

## Why Not An API Verifier?

API-backed verifiers can be useful when you want a hosted score and are willing
to send user emails to a third party. This package is local code: no API key, no
quota, and no remote verification service.

## Comparison

| Capability | email-deliverability | validator.js | deep-email-validator | API verifier |
| --- | --- | --- | --- | --- |
| Syntax and normalization | Yes | Syntax mostly | Yes | Usually |
| DNS MX/Null MX/A fallback | Yes | No | Yes | Usually |
| Disposable/free-provider signals | Yes | No | Disposable | Usually |
| Optional SMTP diagnostics | Yes, explicit | No | Yes | Usually |
| Claims mailbox existence | No | No | Risky in practice | Often implied |
| Browser-safe subpath | Yes | Yes | No | Client call not recommended |
| Requires API key | No | No | No | Yes |
| Required runtime deps | None | None | Yes | SDK/client |

## Package Size

The npm tarball target is under 100 KB while shipping built-in free-provider and
disposable-domain datasets. `bun run release:check` enforces the size budget and
pack allowlist.

## Maintainers

Release and maintenance process lives in the repo:

- [Agent notes](https://github.com/onlyoneaman/email-deliverability/blob/main/AGENTS.md)
- [Package contract](https://github.com/onlyoneaman/email-deliverability/blob/main/docs/CONTRACT.md)
- [Release process](https://github.com/onlyoneaman/email-deliverability/blob/main/docs/RELEASE.md)
- [Maintenance notes](https://github.com/onlyoneaman/email-deliverability/blob/main/docs/MAINTENANCE.md)
