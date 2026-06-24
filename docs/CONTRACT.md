# email-deliverability package contract

Package name: `email-deliverability`

Goal: a polished Node.js and Bun npm package for validating, normalizing, and checking whether an email address's domain is set up to receive mail. It should cover the useful parts of Python `email-validator` and `deep-email-validator`, but avoid their known traps: unclear SMTP claims, typo false positives, hardcoded timeouts, poor runtime boundaries, and large package size.

## Positioning

`email-deliverability` validates email addresses and checks DNS mail deliverability. "Deliverability" in this package means DNS-level ability to receive mail, not inbox placement, spam score, sender reputation, or guaranteed mailbox existence.

It does not promise inbox placement and does not guarantee that a specific mailbox exists. SMTP probing is included as an explicit, opt-in, best-effort diagnostic because users ask for it, but the API must label it as unreliable and separate it from DNS deliverability.

Primary README line:

> Honest email validation for Node.js and Bun: syntax, normalization, DNS MX checks, disposable/free-provider signals, and optional SMTP diagnostics without pretending SMTP proves mailbox existence.

## Runtime and packaging

- Node.js and Bun support via standard APIs.
- Built and tested first with Bun, but positioned as a Node.js and Bun package.
- TypeScript source, bundled `.d.ts`, strict public types.
- ESM-only for the current package. CommonJS support only if it does not meaningfully increase complexity or package size.
- Zero required runtime dependencies for the core package.
- No native Rust/WASM in v1. DNS latency dominates performance, and native npm distribution would add platform complexity and likely increase package size.
- Target npm tarball: under 100 KB with bundled free-domain and disposable-domain datasets.
- Hard package-size failure: over 100,000 bytes unless the limit is deliberately raised with `PACKAGE_SIZE_LIMIT_BYTES` and documented.
- No published source maps by default.
- Generated datasets should be minified sorted arrays or newline strings with lazy `Set` construction. Avoid pre-gzipped embedded assets, Bloom filters for blocking, tries, or minimal-perfect-hash generators in v1 unless measurements prove a clear win.
- DNS and SMTP checks are server-side only. Syntax parsing, normalization, locale formatting, and dataset checks should also be available from a browser/edge-safe subpath that does not import DNS, TCP, or TLS modules.
- The package must not depend on a remote email-verification API, API key, quota, or hosted service. Network activity is limited to caller-enabled DNS resolution and caller-enabled SMTP diagnostics.
- `bun run release:check` must report the packed tarball size and fail when the budget is exceeded.
- Supported runtime matrix: Bun latest stable and Node.js `>=22`.

Per-asset size budget:

- core JS: target <= 35 KB packed;
- type declarations: target <= 15 KB packed;
- free-domain data: target <= 75 KB packed;
- disposable-domain data: target <= 45 KB packed;
- locale dictionaries: target <= 20 KB packed;
- README, license, notice, changelog, and security docs included in npm package: target <= 20 KB packed.

The release-blocking hard fail is 100,000 bytes packed. Exceeding the 100 KB target requires an explicit contract update and changelog note, not just an implementation comment.

## package.json contract

Required package metadata:

- `name`: `email-deliverability`;
- `description`: `Honest email validation, normalization, DNS deliverability checks, and SMTP diagnostics for Node.js and Bun.`;
- `type`: `module`;
- `types`: generated declaration entry;
- `sideEffects`: `false`;
- `engines.node`: active Node.js LTS or newer;
- `license`: explicit SPDX identifier;
- `repository`, `homepage`, and `bugs` fields;
- `publishConfig.provenance: true`;
- `files` allowlist containing only dist files, generated datasets, locale dictionaries, README, license, changelog, security policy, and dataset notices.

Required export map:

```json
{
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  },
  "./syntax": {
    "types": "./dist/syntax.d.ts",
    "import": "./dist/syntax.js"
  },
  "./browser": {
    "types": "./dist/browser.d.ts",
    "import": "./dist/browser.js"
  },
  "./package.json": "./package.json"
}
```

`./syntax` must expose parsing/normalization only. `./browser` may expose parsing, normalization, free-provider checks, disposable checks, typo checks, locale formatting, and policy decisions that do not require DNS or SMTP. DNS/SMTP APIs must not be exported from browser-safe subpaths.

## Publishing and README contract

README positioning must center on honest validation:

- not regex-only;
- not an API wrapper;
- no API key, account, quota, or hosted verification service;
- not SMTP theater;
- zero required runtime dependencies;
- small install size;
- TypeScript-first;
- Node.js and Bun.

Required README sections:

- quick start with returned result handling;
- signup vs login;
- DNS-only deliverability;
- SMTP diagnostics and why SMTP is unreliable;
- disposable and free-provider checks;
- batch validation;
- custom resolver/cache;
- "What this cannot prove";
- "Why not regex?";
- "Why not validator.js?";
- "Why not deep-email-validator?";
- "Why not SMTP verification?";
- comparison table against common packages/API verifiers;
- serverless/browser/edge limitations, especially blocked port 25 and no DNS/TCP access in browsers;
- package-size and dependency proof block;
- error-code and built-in locale/localization guide.

NPM keywords:

```json
[
  "email",
  "email-validation",
  "email-validator",
  "email-verification",
  "email-verifier",
  "email-checker",
  "validate-email",
  "mx-records",
  "dns",
  "smtp",
  "disposable-email",
  "free-email",
  "idn",
  "typescript",
  "bun",
  "nodejs"
]
```

## Public API

### Main validation

```ts
import { validateEmail } from "email-deliverability";

const result = await validateEmail("User+tag@Example.COM", {
  checks: { dns: true },
});

if (result.recommendation === "accept" && result.parsed) {
  console.log(result.parsed.normalized);
} else {
  console.log(result.status, result.reason);
}
```

`validateEmail(input, options)` returns a structured result instead of throwing by default. The simple top-level contract is `status`, `reason`, and `recommendation`; detailed facts, checks, policy decisions, and warnings stay underneath so callers do not confuse syntax validity, DNS status, business policy, and SMTP diagnostics.

`status`, `reason`, and `recommendation` summarize the best deliverability action from the checks that actually ran. `valid` and `decision.accepted` reflect configured blocking policy. They may differ for explicitly diagnostic checks, such as SMTP mailbox rejection when `policy.blockOnSmtpRejection` is false.

```ts
type EmailValidationResult = {
  input: string;

  // Compatibility decision derived from `decision.accepted`.
  // Product flows should prefer status/reason/recommendation.
  valid: boolean;
  status: EmailStatus;
  reason: EmailReason;
  recommendation: EmailRecommendation;

  parsed?: {
    normalized: string;
    local: string;
    domain: string;
    asciiDomain: string;
    asciiEmail: string | null;
    smtputf8: boolean;
  };

  checks: {
    syntax: SyntaxCheck;
    dns: DnsDeliverabilityCheck;
    typo: TypoCheck;
    disposable: DisposableCheck;
    freeProvider: FreeProviderCheck;
    smtp: SmtpProbeCheck;
  };

  issues: EmailIssue[];
  decision: {
    accepted: boolean;
    blockedBy: Array<{
      policy: "syntax" | "dns" | "blockTypo" | "blockDisposable" | "requireBusinessEmail" | "blockOnSmtpRejection" | "requirePublicInternetDomain" | "allowSpecialUseDomains";
      issueCode: string;
    }>;
  };
};

type EmailStatus = "deliverable" | "undeliverable" | "risky" | "unknown";

type EmailReason =
  | "accepted"
  | "invalid_syntax"
  | "not_public_domain"
  | "no_mail_server"
  | "domain_not_found"
  | "mailbox_rejected"
  | "catch_all"
  | "smtp_tempfail"
  | "smtp_timeout"
  | "smtp_blocked"
  | "smtp_error"
  | "disposable"
  | "free_provider"
  | "typo"
  | "inconclusive";

type EmailRecommendation = "accept" | "reject" | "verify";

type EmailIssue = {
  code: string;
  stage: "syntax" | "normalization" | "dns" | "typo" | "disposable" | "freeProvider" | "smtp" | "policy";
  severity: "error" | "warning" | "info";
  message: string;
  path?: Array<string | number>;
  params?: Record<string, unknown>;
  affectsValidity: boolean;
};
```

Every check object must have a stable `status`, including `not_checked`, so callers do not branch on property existence.

`decision.accepted` is derived from issues:

```ts
decision.accepted === !issues.some(issue => issue.affectsValidity)
```

Check result base:

```ts
type CheckStatus = "not_checked" | "pass" | "fail" | "warning" | "unknown" | "timeout" | "error";

type CheckBase = {
  status: CheckStatus;
  reasons: string[];
  durationMs?: number;
};

type SyntaxCheck = CheckBase & {
  status: "pass" | "fail";
};

type DnsDeliverabilityCheck = CheckBase & {
  status: "not_checked" | "pass" | "fail" | "warning" | "unknown" | "timeout" | "error";
  deliverability?: "deliverable" | "undeliverable" | "risky" | "unknown";
  mxRecords?: Array<{ exchange: string; priority: number }>;
};

type TypoCheck = CheckBase & {
  status: "not_checked" | "pass" | "warning";
  suggestion?: string;
  confidence?: number;
};

type DisposableCheck = CheckBase & {
  status: "not_checked" | "pass" | "warning" | "fail";
  disposable?: boolean;
  category?: "disposable" | "allowlisted" | "unknown";
  source?: string;
};

type FreeProviderCheck = CheckBase & {
  status: "not_checked" | "pass" | "warning" | "fail";
  freeProvider?: boolean;
  category?: "free_provider" | "unknown";
  source?: string;
};

type SmtpProbeCheck = CheckBase & {
  status: "not_checked" | "pass" | "fail" | "warning" | "unknown" | "timeout" | "error";
  valid?: true | false | null;
};
```

Also expose:

- `parseEmail(input, options)` for syntax and normalization only. It does not run DNS or account/public-domain policy checks by default.
- `checkDomainDeliverability(domain, options)` for DNS-only checks on a domain.
- `checkEmailDomainDeliverability(email, options)` for DNS-only checks after parsing an email address.
- `probeSmtp(email, options)` for explicit SMTP diagnostics.
- `isValidEmail(input, options): Promise<boolean>` convenience boolean wrapper.
- `isEmailSyntaxValid(input, options): boolean` syntax-only boolean helper.
- `assertValidEmail(input, options)` throwing wrapper.
- `createEmailValidator(defaultOptions)` reusable validator with resolver/cache config.
- `validateEmails(emails, options)` for batch validation.
- `isFreeEmailDomain(domain, options)` for free-provider checks.
- `isDisposableEmailDomain(domain, options)` for disposable-domain checks.
- `getFreeEmailDomains()` and `getDisposableEmailDomains()` for callers that need the bundled raw domain lists.
- `getDatasetInfo()` for source name, source version/commit, license, fetch date, generated date, and domain counts.
- `createDomainSet(domains)` for efficient caller-supplied domain lists.

## Options

```ts
type ValidateEmailOptions = {
  checks?: {
    dns?: boolean; // default true
    typo?: boolean; // default false
    disposable?: boolean; // default false
    freeProvider?: boolean; // default false
    smtp?: boolean; // default false
  };

  syntax?: {
    mode?: "account" | "rfc"; // default "account"
    unicodeSecurity?: "standard" | "strict"; // default "standard"
    allowDisplayName?: boolean; // default false
    allowQuotedLocal?: boolean; // default false
    allowDomainLiteral?: boolean; // default false
    allowEmptyLocal?: boolean; // default false
    allowSmtputf8?: boolean; // default true
  };

  policy?: {
    requirePublicInternetDomain?: boolean; // default true for validateEmail, false for parseEmail
    allowSpecialUseDomains?: boolean; // default false; true in test environments
    requireDnsDeliverable?: boolean | "strict"; // default true
    blockTypo?: boolean; // default false
    blockDisposable?: boolean; // default false
    requireBusinessEmail?: boolean; // default false; blocks free providers
    blockOnSmtpRejection?: boolean; // default false
  };

  dns?: {
    timeoutMs?: number; // default 5000
    resolver?: EmailDnsResolver;
    cache?: EmailValidationCache | false;
  };

  smtp?: SmtpProbeOptions;

  typo?: {
    suggestEvenWhenDeliverable?: boolean; // default false
    commonDomains?: Iterable<string>;
  };

  datasets?: {
    commonDomains?: string[];
    freeDomains?: {
      mode?: "extend" | "replace"; // default "extend"
      domains: Iterable<string>;
    };
    disposableDomains?: {
      mode?: "extend" | "replace"; // default "extend"
      domains: Iterable<string>;
    };
    allowedDisposableDomains?: Iterable<string>;
    blockedDisposableDomains?: Iterable<string>;
  };

  timeout?: {
    totalMs?: number; // no default unless set by caller
  };

  locale?: SupportedLocale | (string & {}); // BCP 47 language tag, default "en"
  signal?: AbortSignal;
};

type SupportedLocale =
  | "en"
  | "es"
  | "fr"
  | "de"
  | "pt-BR"
  | "hi"
  | "ja"
  | "zh-CN";

type SmtpProbeOptions = {
  sender?: string;
  heloName?: string;
  timeoutMs?: number; // default 5000
  port?: number; // default 25
  tls?: "disable" | "opportunistic" | "require"; // default "opportunistic"
  allowPrivateNetworks?: boolean; // default false
  detectCatchAll?: boolean; // default true when SMTP probing is enabled
  catchAllAddressFactory?: () => string;
};
```

Default behavior should match Python `email-validator` and be appropriate for account creation:

- syntax and normalization by default;
- DNS deliverability by default;
- typo, disposable, free-provider, and SMTP checks are off by default;
- no typo, disposable, free-provider, or SMTP result blocks acceptance unless explicitly configured in `policy`.
- no SMTP probing by default.

For login paths, recommend `checks: { dns: false }` to avoid DNS work on every login.

Policy flags that require checks implicitly enable those checks. For example, `policy.blockDisposable: true` enables `checks.disposable`, and `policy.requireBusinessEmail: true` enables `checks.freeProvider`.

When `checks.smtp: true`, SMTP remains diagnostic by default and runs catch-all detection after the target recipient is accepted. Permanent recipient rejection is surfaced in top-level `status/reason/recommendation`; it affects `decision.accepted` only when `policy.blockOnSmtpRejection` is explicitly true, and only for narrow permanent mailbox rejection results.

Timeout and cancellation precedence:

- external `signal` abort wins first;
- `timeout.totalMs` is a whole-operation deadline when provided;
- per-check timeouts such as `dns.timeoutMs` and `smtp.timeoutMs` apply within the remaining total deadline;
- cancellation returns structured `aborted` or `timeout` issues/check statuses, except programmer errors may still throw.

For signup/account creation, recommend:

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

For SMTP diagnostics:

```ts
await validateEmail(email, {
  checks: {
    dns: true,
    smtp: true,
  },
  smtp: {
    sender: "verify@example.com",
    heloName: "example.com",
    timeoutMs: 5000,
  },
});
```

## Syntax and normalization contract

Must support:

- exactly one unquoted `@`;
- local/domain split with clear errors;
- ASCII local parts with normal safe characters;
- internationalized local parts when `allowSmtputf8` is true;
- IDN domains using `domainToASCII`/`domainToUnicode` or equivalent platform APIs;
- normalized output suitable for database storage;
- `asciiDomain` always when domain is valid;
- `asciiEmail` only when the address can be represented without SMTPUTF8;
- optional display-name parsing: `Name <user@example.com>`;
- optional quoted local parts;
- optional domain literals in `syntax.mode: "rfc"` or when explicitly allowed; rejected in default account mode;
- optional empty local part for alias use cases;
- octet length checks: local part UTF-8 bytes <= 64, each ASCII/IDNA label <= 63 octets, full domain <= 255 octets, and normal addr-spec <= 254 octets;
- rejection of whitespace/control/format/private-use unsafe Unicode;
- a documented strict Unicode security subset when `syntax.unicodeSecurity: "strict"` is enabled.

Normalization rules:

- preserve the parsed local part for storage and SMTP wire use;
- lowercase the domain;
- preserve plus tags, dots, and provider-specific local-part semantics;
- do not dot-strip, tag-strip, provider-canonicalize, or create login identity keys in v1.
- if NFC or other local-part Unicode normalization is exposed, it must be a separate display/helper field and not the delivery/probing local part.

Must reject by default:

- multiple `@` signs;
- missing local part;
- missing domain;
- spaces/control characters in unquoted local part;
- public-account policy domains without a dot when `policy.requirePublicInternetDomain` is true;
- special-use domains such as `localhost`, `invalid`, `test`, and `example` unless `policy.allowSpecialUseDomains` is true;
- malformed punycode/IDN domains;
- obsolete email syntax that is technically RFC-valid but bad for account identity.

IDNA rules:

- reject empty `domainToASCII` output;
- reject malformed A-labels;
- require round-trip sanity between Unicode and ASCII forms where platform APIs allow it;
- enforce label/domain octet limits after ASCII conversion.

## DNS deliverability contract

DNS deliverability means the domain appears configured to receive email.

Checks:

- query MX records;
- sort MX records by priority;
- detect Null MX only when the sole MX record is priority `0` and exchange `.`; mark it undeliverable;
- if `.` appears alongside other MX records, return a malformed Null MX/risky DNS result instead of clean `null_mx`;
- if no MX exists, check fallback A and AAAA records;
- if fallback A/AAAA exists, treat as deliverable;
- do not treat SPF `-all` as receive-mail deliverability evidence. SPF is sending policy only and may be exposed separately as metadata/warning, not as undeliverable.
- return DNS response metadata and reason codes;
- honor `dns.timeoutMs`;
- support injected resolver for tests, custom DNS, and caching;
- support built-in small LRU/TTL cache through `createEmailValidator`.

No DNS call should be made when `checks.dns` is false.

Domain literals:

- when domain literals are allowed, DNS deliverability returns `status: "not_checked"` with reason `unsupported_domain_literal`;
- SMTP probing of a domain literal applies the same private/reserved IP protections as MX-based probing.

Default DNS decision matrix:

| DNS status | Default issue severity | Affects acceptance by default |
|---|---:|---:|
| `deliverable` | info/pass | no |
| `undeliverable` from Null MX, NXDOMAIN, or no mail records | error | yes |
| `risky` / malformed DNS | warning | no |
| `unknown` | warning | no |
| `timeout` | warning | no |
| `dns_error` | warning | no |

`policy.requireDnsDeliverable: "strict"` makes `risky`, `unknown`, `timeout`, and `dns_error` affect acceptance.

Resolver contract:

```ts
type EmailDnsResolver = {
  resolveMx(domain: string, options?: ResolveOptions): Promise<Array<{ exchange: string; priority: number }>>;
  resolve4(domain: string, options?: ResolveOptions): Promise<string[]>;
  resolve6(domain: string, options?: ResolveOptions): Promise<string[]>;
  lookup?(hostname: string, options?: ResolveOptions): Promise<Array<{ address: string; family: 4 | 6 }>>;
};

type ResolveOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};
```

Cache contract:

- cache keys include record type and normalized ASCII domain;
- positive and negative results may be cached with separate TTLs;
- cache is shared by DNS deliverability and SMTP MX resolution when using `createEmailValidator`;
- tests must be able to inject a resolver and disable cache for deterministic no-network behavior.

Deliverability statuses:

- `deliverable`
- `undeliverable`
- `risky`
- `unknown`
- `timeout`
- `dns_error`

Reason codes:

- `mx_found`
- `null_mx`
- `no_mx`
- `fallback_a`
- `fallback_aaaa`
- `no_dns_records`
- `domain_not_found`
- `dns_timeout`
- `dns_error`
- `malformed_null_mx`
- `special_use_domain`

## SMTP probe contract

SMTP probing is included because users repeatedly ask whether a mailbox exists, but it must be opt-in and clearly separated from validation. It is a diagnostic probe, not a mailbox-existence guarantee.

Rules:

- Never run SMTP unless `checks.smtp: true` or `probeSmtp()` is called directly.
- Require a configurable timeout.
- Require or derive a sane sender address. Prefer explicit `smtp.sender`; otherwise use the null reverse-path `<>` and mark the result with a warning because some servers reject or distrust it.
- Support configurable HELO/EHLO name.
- Derive `heloName` from `smtp.heloName`, `smtp.sender` domain, or `localhost` in that order, and include a warning when `localhost` is used.
- Sanitize all SMTP command inputs against CRLF injection.
- Use `EHLO`, fallback to `HELO`.
- `smtp.tls: "opportunistic"` attempts STARTTLS only when advertised and falls back to plaintext if not advertised; `"require"` returns `starttls_not_advertised` if missing; `"disable"` never upgrades.
- If STARTTLS is used: `EHLO -> STARTTLS -> TLS upgrade -> EHLO again -> MAIL FROM -> RCPT TO`.
- Use the MX hostname as TLS SNI/servername even when connecting to a pre-resolved IP literal.
- For SMTPUTF8 addresses: discover capabilities with ASCII/A-label EHLO first; HELO fallback makes SMTPUTF8 probing inconclusive; if the server does not advertise `SMTPUTF8`, return inconclusive with `smtputf8_not_advertised`; if advertised without `8BITMIME`, return inconclusive/risky with `smtputf8_invalid_capability`; if validly advertised, send `MAIL FROM:<...> SMTPUTF8`.
- Probe with `MAIL FROM` and `RCPT TO`, then quit without sending DATA.
- Return `valid: true | false | null`, where `null` means inconclusive.
- Most operational failures must return `valid: null`, not `false`. Examples: blocked port 25, provider tarpitting, greylisting, catch-all ambiguity, proxy/network failure, TLS negotiation failure, unsupported SMTPUTF8, or provider status hiding.
- Detect catch-all behavior by default when SMTP probing is enabled and the target recipient is accepted; use a randomized address and allow `smtp.detectCatchAll: false` to opt out.
- Rate-limit/concurrency-limit batch SMTP probes.
- Do not include proxy management, SOCKS support, headless provider automation, provider-specific bypass logic, SMTP relay routing, Docker images, or native addons in v1. Those are infrastructure-product concerns, not a small library contract.
- Resolve MX targets to IP addresses and block private, loopback, link-local, multicast, documentation, and otherwise reserved ranges by default before opening TCP sockets.
- Connect only to a pre-resolved and vetted IP literal, never to an unvetted hostname.
- Re-check `socket.remoteAddress` after connect before sending SMTP commands.
- Apply blocking to MX targets, CNAME-expanded targets, fallback A/AAAA records, domain literals, IPv4-mapped IPv6, NAT64-derived addresses when detectable, 6to4/Teredo, CGNAT, unique-local, link-local, loopback, multicast, unspecified, documentation, and reserved ranges.
- Expose `smtp.allowPrivateNetworks?: boolean`, default false.
- Warn that probing can trigger abuse systems, blacklisting, greylisting, and false results.

SMTP result reasons:

- `accepted`
- `mailbox_rejected`
- `catch_all`
- `temporary_failure`
- `greylisted`
- `connection_refused`
- `connection_timeout`
- `network_blocked`
- `tls_failed`
- `starttls_not_advertised`
- `smtp_error`
- `provider_hides_status`
- `provider_rejected_probe`
- `private_network_blocked`
- `reserved_ip_blocked`
- `mx_resolution_failed`
- `smtputf8_not_advertised`
- `smtputf8_invalid_capability`
- `inconclusive`

SMTP is diagnostic by default. It affects `decision.accepted` only when `policy.blockOnSmtpRejection` is explicitly true, and only for narrow permanent mailbox rejection states. Timeouts, network blocks, provider-level probe rejection, greylisting, catch-all, and inconclusive capability states must not block acceptance by default.

## Typo detection contract

Deep-email-validator issue history shows typo detection causes false positives. Therefore:

- `checks.typo` default is false.
- Typo detection is an email-entry UX helper, not abuse prevention and not deliverability evidence.
- Typo results are warnings/suggestions, not validation failures, unless `policy.blockTypo` is true. README examples should avoid recommending `blockTypo` for signup abuse control.
- Built-in common-domain list should be small and inspectable.
- Allow caller-supplied `typo.commonDomains`.
- Never suggest a replacement when the original domain has valid DNS deliverability unless `typo.suggestEvenWhenDeliverable: true`.
- `TypoCheck` uses the shared check status shape defined in the public result model.

## Free-provider and disposable-domain contract

Deep-email-validator includes disposable checks, and users commonly want to distinguish free mailbox providers from business/work domains.

Free-provider support:

- bundle a full free-domain dataset in core, initially derived from `free-email-domains` after license/provenance review;
- keep the dataset as a compact generated sorted array or newline string, whichever produces the smaller published tarball;
- construct the lookup `Set` lazily only when free-provider checks are used;
- expose `isFreeEmailDomain(domain)` and return structured free-provider results;
- use free-provider data for `checks.freeProvider`, domain typo context, and optional work-email policies;
- free-provider status is a warning by default and affects acceptance only with `policy.requireBusinessEmail: true`.

Disposable support:

- bundle a compact maintained disposable-domain dataset in core, targeting roughly 5k-10k domains rather than huge 100k+ aggregate lists;
- derive the initial source from an active, permissively licensed upstream; v1 uses `disposable-email-domains-js` after license/provenance review and keeps exact-only matching;
- do not blindly merge every public disposable list. Source poisoning and stale mirrors are real risks;
- keep the dataset as a compact generated sorted array or newline string, whichever produces the smaller published tarball;
- construct the lookup `Set` lazily only when disposable checks are used;
- accept `disposableDomains` as an injected iterable/set so callers can override or extend the bundled list;
- accept `allowedDisposableDomains` and `blockedDisposableDomains` local overrides. Local allow/deny overrides win over bundled data;
- expose `isDisposableEmailDomain(domain, options)`;
- expose helper `createDomainSet()`;
- return structured disposable results;
- return a category/reason rather than a naked boolean, with at least `disposable`, `allowlisted`, and `unknown`;
- default matching is exact normalized domain matching only after IDNA normalization;
- parent-domain matching must not cross public suffix boundaries. If public-suffix-aware matching cannot be implemented within the size budget, keep exact-only matching and document that choice;
- support wildcard matching only if the source provides explicit wildcard entries, kept in a separate generated list.

Do not use Bloom filters, tries, minimal-perfect-hash generators, compressed embedded blobs, runtime fetching, optional companion packages, or multi-tier disposable risk scoring in v1. The package should stay simple and inspectable.

Disposable generator rules:

- normalize domains with the same IDNA/domain normalization used by validation;
- dedupe and sort deterministically;
- preserve exact and wildcard tables separately if wildcards exist;
- maintain a small project-owned exclusion list only for high-confidence false positives. Do not treat any global allowlist as canonical;
- fail dataset verification if project-owned excluded domains enter the generated disposable output;
- require source metadata for every generated dataset: upstream name, upstream URL, commit or version, license, fetch date, generator version, generated date, exact count, wildcard count, and exclusions count;
- reject new upstream sources unless they have compatible licensing and a review note explaining why they are trusted;
- support a documented false-positive reporting workflow;
- dataset updates must include changelog notes for added/removed domains and source changes;
- dataset-only releases are patch releases, but the changelog must call out that optional disposable/free-provider policy outcomes can change.

Disposable check can affect acceptance only when `policy.blockDisposable: true`. Default: warning.

## Batch contract

Expose `validateEmails(emails, options)`:

- concurrency control;
- shared resolver/cache;
- shared typo/free-provider/disposable domain sets;
- separate DNS and SMTP concurrency limits;
- stable result order;
- summary counts.

This avoids users writing unbounded `Promise.all` against DNS/SMTP.

```ts
type ValidateEmailsOptions = ValidateEmailOptions & {
  batch?: {
    concurrency?: number;
    dnsConcurrency?: number;
    smtpConcurrency?: number;
  };
};

type ValidateEmailsResult = {
  results: EmailValidationResult[];
  summary: {
    total: number;
    accepted: number;
    rejected: number;
    byStage: Record<EmailIssue["stage"], number>;
    byCode: Record<string, number>;
  };
};
```

## Error and message contract

Every failure must have:

- stable machine-readable code;
- default human-readable English message;
- localized human-readable message when `locale` is supported;
- structured `path` and `params` for callers that need custom messages;
- check stage: `syntax`, `normalization`, `dns`, `typo`, `disposable`, `freeProvider`, `smtp`, `policy`;
- no ambiguous "valid false" without a reason.
- multiple issues in one result via `issues: EmailIssue[]`.

Callers must never need to parse English error messages. `code`, `path`, and `params` are the stable integration surface for custom UI copy. `message` is for direct display and may be localized through `locale`.

Locale support:

- v1 ships built-in reviewed messages for `en`, `es`, `fr`, `de`, `pt-BR`, `hi`, `ja`, and `zh-CN`;
- `locale` accepts BCP 47 language tags;
- region-specific locales fall back to the base language when possible, e.g. `es-MX` -> `es`, then `en`;
- unsupported locales fall back to English per message;
- translations are stored in simple generated dictionaries keyed by stable issue `code`, not embedded in validation logic;
- the formatter interpolates only named `params`;
- missing translations fail tests for every supported locale;
- locale dictionaries count against the package-size budget;
- translation changes are patch releases unless issue codes or params change.

No exceptions in normal validation flow. Throwing API is a wrapper.

## Data flow

Canonical pipeline:

```text
input
  -> parse
  -> normalize local/domain
  -> classify syntax and public-domain policy
  -> dataset checks: typo/free-provider/disposable
  -> DNS deliverability if enabled
  -> SMTP diagnostics if enabled
  -> policy decision
  -> structured result
```

Domain normalization must be implemented once and reused by runtime checks and dataset generation.

## Module boundaries

- `parse`: syntax scanning, display-name/quoted-local/domain-literal parsing, and syntax issues only.
- `domain-normalization`: IDNA conversion, ASCII domain generation, special-use/public-domain classification helpers.
- `datasets`: generated free/disposable/common-domain data, lazy sets, allowlists, and source metadata.
- `dns`: MX/A/AAAA resolution, Null MX handling, DNS deliverability decisions, resolver/cache adapters.
- `smtp`: TCP/TLS SMTP diagnostics, SSRF guard, SMTPUTF8/STARTTLS handling. No validation code imports `net`/`tls` outside this module.
- `policy`: converts checks/issues into `decision.accepted` and `blockedBy`.
- `locale`: message dictionaries, fallback, and parameter interpolation.
- `batch`: concurrency wrappers over `createEmailValidator`.

Network access is allowed only in `dns` and `smtp`. Unit tests for all other modules must run with no network.

## Lessons from existing issue trackers

From `JoshData/python-email-validator`:

- users ask for actual mailbox existence; answer with explicit SMTP diagnostics but do not overclaim;
- users ask for async deliverability; JS API is async-first;
- DNS timeout must be enforceable, including total-operation deadlines, because per-query timeouts alone can still exceed web-server budgets;
- resolver/cache injection matters;
- Unicode homoglyph/security options matter;
- Pydantic/model breakage shows API stability matters;
- public helper APIs and config names must be explicit so callers know what is stable;
- special-use/test-domain behavior must be configurable;
- display-name, quoted local, domain literal, and strict Unicode/security modes should be explicit options;
- localized error messages require stable codes, paths, and params so callers do not parse English messages;
- error messages must be clear.

From `mfbx9da4/deep-email-validator`:

- SMTP timeout must be configurable;
- SMTP must disable cleanly;
- SMTP `false`/disabled settings must be test-covered because users hit port 25 blocks on Netlify, Lambda, Docker, and similar environments;
- SMTP can cause blacklisting if careless;
- SMTP socket lifecycle and response parsing must be tested: no hanging promise on close, no double resolution, no partial SMTP code matches such as treating `2501` as `250`;
- typo detection creates false positives;
- TLD/domain suggestion logic must be overrideable;
- disposable provider lists go stale;
- import/runtime docs must be clear;
- browser/serverless limitations must be documented;
- users want multiple failure reasons, not only first failure;
- package should avoid outdated heavy dependencies.

From adjacent packages:

- users repeatedly hit `isEmail` false positives and special-character edge cases in generic validators, so syntax fixtures must include hostile punctuation, Unicode separators, non-breaking spaces, quotes, and invalid local/domain combinations;
- users report broken package exports, missing `dist` files, and missing TypeScript declarations, so release smoke tests must install the packed tarball in fresh projects and verify ESM imports, browser/syntax subpath imports, and type resolution;
- users need disable switches for network checks, so DNS and SMTP must be individually disableable and testable with injected resolvers;
- API-backed verifier packages cause API-key, quota, and serverless deployment confusion, so this package must clearly state that it is local code with no hosted service dependency;
- disposable-domain users report both false negatives for rotating providers and false positives for legitimate services, so the dataset pipeline needs local overrides, source metadata, update cadence, and a false-positive workflow;
- disposable-domain source poisoning has happened in public lists, so dataset generation must prefer conservative vetted sources over "largest list wins";
- free-provider, disposable, privacy/alias, and corporate domains are separate concepts. The v1 API must not collapse them into one "bad email" bucket;
- typo-correction packages have long-running false-positive issues, so typo suggestions remain opt-in UX signals rather than default blocking policy.

## What we intentionally do not claim

- We do not guarantee a mailbox exists.
- We do not guarantee inbox placement.
- We do not guarantee an email will not bounce.
- We do not promise browser support for DNS/SMTP checks.
- We do not make SMTP probing part of default validation.
- We do not provide proxy infrastructure, provider-specific mailbox verification, or an API-backed verification service.
- We do not treat disposable/free-provider/typo signals as proof of fraud.
- We do not reject typo/disposable/free-domain results by default.

## Acceptance criteria for v1

- Bun tests pass.
- Node tests pass.
- Type declarations are generated and type-tested.
- Package tarball is under 100 KB with bundled free-domain and disposable-domain datasets, or the size increase is justified in this file.
- Zero required runtime dependencies.
- `npm pack --dry-run` shows only intended files.
- Packed-tarball smoke tests install the exact tarball in fresh Node and Bun projects and verify runtime imports, browser/syntax subpath imports, type declarations, and absence of unintended files.
- DNS deliverability behavior covers MX, Null MX, no MX fallback A/AAAA, NXDOMAIN, timeout, and DNS error.
- SMTP probing is opt-in, timeout-bound, and returns inconclusive states instead of pretending certainty.
- SMTP tests cover blocked-network/inconclusive paths and permanent mailbox rejection separately so only the latter can affect acceptance with `policy.blockOnSmtpRejection`.
- README contains explicit examples for signup, login, DNS-only, SMTP probe, free-provider detection, disposable detection, batch validation, and custom resolver/cache.
- README has a prominent "what this cannot prove" section.
- README states that no API key, quota, or hosted verifier is used.
- README documents browser, edge, serverless, and blocked-port-25 limitations.
- Tests include fixtures for issue-derived cases: multiple `@`, display-name input, malformed punycode, special-use domains, `.test`, `.example`, quoted local, Unicode local part, plus addressing preservation, typo false-positive avoidance, SMTP disabled, SMTP timeout, SMTP private-network blocking, SMTPUTF8 not advertised, malformed Null MX, and no-network resolver injection.
- Tests include publish-shape fixtures for named imports, subpath imports, NodeNext type resolution, and Bun imports from the packed tarball.
- `bun run release:check` covers build, tests, typecheck, dataset invariants, `npm pack` allowlist checks, and tarball-size hard fail.
- GitHub workflow changes are not part of this contract unless explicitly requested; maintainer process belongs in `AGENTS.md`, `docs/`, `scripts/`, and tests.
- Dataset metadata is published in the package: source name, source version or commit SHA, license, fetch date, transform script version, generated date, and domain counts.
- Dataset SemVer policy is documented: API/default/reason-code changes are normal SemVer; dataset-only updates are patch releases with changelog notes because they can change optional policy outcomes.
- Error-code and locale tests assert that each issue has stable `code`, `path`, `params`, default English `message`, and complete messages in every supported locale.
- Locale fallback tests cover exact locale match, region-to-base fallback, unsupported-locale fallback, missing-message fallback, and parameter interpolation.

Release and supply-chain requirements:

- publish only after `bun run release:check` passes;
- local/manual publishes are allowed as an explicit maintainer fallback with `npm publish --access public --provenance=false`;
- maintainers use 2FA;
- release tags must match `package.json` versions;
- release verification uses frozen lockfile installs where possible;
- dataset update workflows verify source versions/counts/licenses and run `bun run datasets:verify`;
- bundled dataset licenses must use compatible SPDX identifiers, include required license/NOTICE text, and fail release verification on license drift;
- `SECURITY.md` documents supported versions, disclosure contact, and response policy.
