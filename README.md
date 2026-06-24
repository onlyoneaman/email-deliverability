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
reputation, or guaranteed mailbox existence. SMTP probing is unreliable: many
providers tarp it, hide recipient status, block port 25, greylist, or return
false answers to reduce abuse.

## Common Flows

Signup/account creation:

```ts
await validateEmail(email, {
  checks: { dns: true, typo: true, disposable: true, freeProvider: true },
  policy: { blockDisposable: true },
});
```

Login:

```ts
await validateEmail(email, { checks: { dns: false } });
```

DNS-only deliverability:

```ts
import { checkEmailDomainDeliverability } from "email-deliverability";

const dns = await checkEmailDomainDeliverability("user@example.com");
```

SMTP diagnostics:

```ts
await validateEmail(email, {
  checks: { smtp: true },
  smtp: { sender: "probe@example.com", heloName: "example.com" },
});
```

## Runtime Boundaries

`email-deliverability` has no required runtime dependencies and does not call a
remote verification API. DNS and SMTP are server-side only.

- `email-deliverability`: full Node.js/Bun server API.
- `email-deliverability/syntax`: parsing and normalization only.
- `email-deliverability/browser`: browser-safe parsing and dataset helpers.
- The package is ESM-only. CommonJS projects should use dynamic `import()`.

Browsers, edge runtimes, serverless platforms, and containers may block DNS or
port 25. Disable those checks when they do not fit your runtime.

## Maintainers

Release and maintenance process lives in the repo:

- [Agent notes](https://github.com/onlyoneaman/email-deliverability/blob/main/AGENTS.md)
- [Package contract](https://github.com/onlyoneaman/email-deliverability/blob/main/docs/CONTRACT.md)
- [Release process](https://github.com/onlyoneaman/email-deliverability/blob/main/docs/RELEASE.md)
- [Maintenance notes](https://github.com/onlyoneaman/email-deliverability/blob/main/docs/MAINTENANCE.md)
