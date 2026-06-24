import { lookup, resolve4, resolve6, resolveMx } from "node:dns/promises";
import { issue } from "./result.js";
import type {
  DnsDeliverabilityCheck,
  EmailDnsResolver,
  EmailIssue,
  EmailValidationCache,
  ParsedEmail,
  ResolveOptions,
  ValidateEmailOptions,
} from "./types.js";

const DEFAULT_DNS_TIMEOUT_MS = 5_000;
const POSITIVE_TTL_MS = 300_000;
const NEGATIVE_TTL_MS = 60_000;

export const defaultDnsResolver: EmailDnsResolver = {
  resolveMx(domain, options) {
    return resolveMx(domain);
  },
  resolve4(domain, options) {
    return resolve4(domain);
  },
  resolve6(domain, options) {
    return resolve6(domain);
  },
  async lookup(hostname, options) {
    const result = await lookup(hostname, { all: true });
    return result
      .filter((entry): entry is { address: string; family: 4 | 6 } =>
        entry.family === 4 || entry.family === 6,
      )
      .map((entry) => ({ address: entry.address, family: entry.family }));
  },
};

export async function checkDnsDeliverability(args: {
  parsed: ParsedEmail;
  options: ValidateEmailOptions;
  cache?: EmailValidationCache | false;
}): Promise<{ check: DnsDeliverabilityCheck; issues: EmailIssue[] }> {
  const startedAt = performance.now();
  if (isDomainLiteral(args.parsed.asciiDomain)) {
    return {
      check: {
        status: "not_checked",
        reasons: ["unsupported_domain_literal"],
        durationMs: elapsed(startedAt),
      },
      issues: [],
    };
  }

  const resolver = args.options.dns?.resolver ?? defaultDnsResolver;
  const timeoutMs = args.options.dns?.timeoutMs ?? DEFAULT_DNS_TIMEOUT_MS;
  const cache = args.options.dns?.cache === false ? false : (args.options.dns?.cache ?? args.cache);
  const domain = args.parsed.asciiDomain;

  try {
    const mxRecords = await cached(cache, `mx:${domain}`, () =>
      resolveRecord(() => resolver.resolveMx(domain, resolveOptions(args.options.signal, timeoutMs)), {
        timeoutMs,
        emptyOnNoData: true,
        ...(args.options.signal ? { signal: args.options.signal } : {}),
      }),
    );
    const sortedMx = [...mxRecords].sort((left, right) => left.priority - right.priority);

    if (isNullMx(sortedMx)) {
      const code = "email.dns.null_mx";
      return {
        check: {
          status: "fail",
          reasons: ["null_mx"],
          deliverability: "undeliverable",
          mxRecords: sortedMx,
          durationMs: elapsed(startedAt),
        },
        issues: [dnsIssue(code, args.options)],
      };
    }

    if (sortedMx.some((record) => isNullMxExchange(record.exchange))) {
      return warningResult(startedAt, "malformed_null_mx", "email.dns.malformed_null_mx", args.options, sortedMx);
    }

    if (sortedMx.length > 0) {
      return {
        check: {
          status: "pass",
          reasons: ["mx_found"],
          deliverability: "deliverable",
          mxRecords: sortedMx,
          durationMs: elapsed(startedAt),
        },
        issues: [],
      };
    }

    const [aRecords, aaaaRecords] = await Promise.all([
      cached(cache, `a:${domain}`, () =>
        resolveRecord(() => resolver.resolve4(domain, resolveOptions(args.options.signal, timeoutMs)), {
          timeoutMs,
          emptyOnNoData: true,
          ...(args.options.signal ? { signal: args.options.signal } : {}),
        }),
      ),
      cached(cache, `aaaa:${domain}`, () =>
        resolveRecord(() => resolver.resolve6(domain, resolveOptions(args.options.signal, timeoutMs)), {
          timeoutMs,
          emptyOnNoData: true,
          ...(args.options.signal ? { signal: args.options.signal } : {}),
        }),
      ),
    ]);

    if (aRecords.length > 0) {
      return {
        check: {
          status: "pass",
          reasons: ["no_mx", "fallback_a"],
          deliverability: "deliverable",
          durationMs: elapsed(startedAt),
        },
        issues: [],
      };
    }
    if (aaaaRecords.length > 0) {
      return {
        check: {
          status: "pass",
          reasons: ["no_mx", "fallback_aaaa"],
          deliverability: "deliverable",
          durationMs: elapsed(startedAt),
        },
        issues: [],
      };
    }

    return {
      check: {
        status: "fail",
        reasons: ["no_mx", "no_dns_records"],
        deliverability: "undeliverable",
        durationMs: elapsed(startedAt),
      },
        issues: [dnsIssue("email.dns.no_mail_records", args.options)],
      };
  } catch (error) {
    if (isAbortError(error) || isTimeoutError(error)) {
      return warningResult(startedAt, "dns_timeout", "email.dns.timeout", args.options);
    }
    if (isNotFoundError(error)) {
      return {
        check: {
          status: "fail",
          reasons: ["domain_not_found"],
          deliverability: "undeliverable",
          durationMs: elapsed(startedAt),
        },
        issues: [dnsIssue("email.dns.domain_not_found", args.options)],
      };
    }
    return warningResult(startedAt, "dns_error", "email.dns.error", args.options);
  }
}

function dnsIssue(code: string, options: ValidateEmailOptions): EmailIssue {
  const affectsValidity = options.policy?.requireDnsDeliverable !== false;
  return issue(code, "dns", affectsValidity, { path: ["domain"] });
}

async function cached<T>(
  cache: EmailValidationCache | false | undefined,
  key: string,
  resolve: () => Promise<T>,
): Promise<T> {
  if (cache) {
    const cachedValue = cache.get<T>(key);
    if (cachedValue !== undefined) return cachedValue;
  }
  const value = await resolve();
  if (cache) {
    cache.set(key, value, isEmptyResult(value) ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS);
  }
  return value;
}

function resolveOptions(signal: AbortSignal | undefined, timeoutMs: number): ResolveOptions {
  return signal ? { signal, timeoutMs } : { timeoutMs };
}

function isEmptyResult(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

function isNullMx(records: Array<{ exchange: string; priority: number }>): boolean {
  return records.length === 1 && records[0]?.priority === 0 && isNullMxExchange(records[0].exchange);
}

function isNullMxExchange(exchange: string): boolean {
  return exchange === "." || exchange === "";
}

function warningResult(
  startedAt: number,
  reason: string,
  code: string,
  options: ValidateEmailOptions,
  mxRecords?: Array<{ exchange: string; priority: number }>,
): { check: DnsDeliverabilityCheck; issues: EmailIssue[] } {
  const strict = options.policy?.requireDnsDeliverable === "strict";
  return {
    check: {
      status: reason === "dns_timeout" ? "timeout" : reason === "dns_error" ? "error" : "warning",
      reasons: [reason],
      deliverability: reason === "malformed_null_mx" ? "risky" : "unknown",
      ...(mxRecords ? { mxRecords } : {}),
      durationMs: elapsed(startedAt),
    },
    issues: [issue(code, "dns", strict, { path: ["domain"], severity: strict ? "error" : "warning" })],
  };
}

async function resolveRecord<T>(
  resolve: () => Promise<T>,
  options: ResolveOptions & { emptyOnNoData?: boolean },
): Promise<T> {
  try {
    return await withTimeout(resolve(), options);
  } catch (error) {
    if (options.emptyOnNoData && isNoDataError(error)) return [] as T;
    throw error;
  }
}

async function withTimeout<T>(promise: Promise<T>, options?: ResolveOptions): Promise<T> {
  if (!options?.timeoutMs && !options?.signal) return promise;
  const controller = new AbortController();
  const timeout = options.timeoutMs
    ? setTimeout(() => controller.abort(new DOMException("DNS timeout", "TimeoutError")), options.timeoutMs)
    : undefined;
  const listeners: Array<() => void> = [];
  const abortPromise = new Promise<never>((_, reject) => {
    const abort = () => reject(options?.signal?.reason ?? new DOMException("Aborted", "AbortError"));
    if (options?.signal?.aborted) abort();
    if (options?.signal) {
      options.signal.addEventListener("abort", abort, { once: true });
      listeners.push(() => options.signal?.removeEventListener("abort", abort));
    }
    controller.signal.addEventListener("abort", abort, { once: true });
    listeners.push(() => controller.signal.removeEventListener("abort", abort));
  });
  try {
    return await Promise.race([promise, abortPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
    for (const remove of listeners) remove();
  }
}

function isDomainLiteral(domain: string): boolean {
  return domain.startsWith("[") && domain.endsWith("]");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError";
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOTFOUND"
  );
}

function isNoDataError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENODATA"
  );
}

function elapsed(startedAt: number): number {
  return Math.max(0, Math.round((performance.now() - startedAt) * 1000) / 1000);
}
