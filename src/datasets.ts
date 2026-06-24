import type {
  DisposableCheck,
  FreeProviderCheck,
  ParsedEmail,
  ValidateEmailOptions,
} from "./types.js";
import { normalizeDomainName } from "./domain.js";
import {
  DATASET_SOURCE_INFO,
  DISPOSABLE_DOMAIN_DATA,
  FREE_DOMAIN_DATA,
} from "./generated/domain-data.js";

let freeDomains: string[] | undefined;
let disposableDomains: string[] | undefined;
let freeDomainSet: Set<string> | undefined;
let disposableDomainSet: Set<string> | undefined;

export function getFreeEmailDomains(): string[] {
  return [...builtInFreeDomains()];
}

export function getDisposableEmailDomains(): string[] {
  return [...builtInDisposableDomains()];
}

export function getDatasetInfo() {
  return {
    generatedAt: DATASET_SOURCE_INFO.generatedAt,
    generatorVersion: DATASET_SOURCE_INFO.generatorVersion,
    sources: DATASET_SOURCE_INFO.sources.map((source) => ({ ...source })),
    counts: {
      free: builtInFreeDomains().length,
      disposable: builtInDisposableDomains().length,
    },
  };
}

export function createDomainSet(domains: Iterable<string>): Set<string> {
  return new Set(Array.from(domains, normalizeDomain).filter(Boolean));
}

export function isFreeEmailDomain(domain: string, options: ValidateEmailOptions = {}): boolean {
  return buildFreeDomainSet(options).has(normalizeDomain(domain));
}

export function isDisposableEmailDomain(
  domain: string,
  options: ValidateEmailOptions = {},
): boolean {
  const normalized = normalizeDomain(domain);
  const allowed = createDomainSet(options.datasets?.allowedDisposableDomains ?? []);
  if (allowed.has(normalized)) return false;
  return buildDisposableDomainSet(options).has(normalized);
}

export function checkFreeProvider(
  parsed: ParsedEmail,
  options: ValidateEmailOptions,
): { check: FreeProviderCheck } {
  const freeProvider = isFreeEmailDomain(parsed.asciiDomain, options);
  return {
    check: freeProvider
      ? {
          status: "warning",
          reasons: ["free_provider"],
          freeProvider: true,
          category: "free_provider",
          source: "built_in",
        }
      : {
          status: "pass",
          reasons: [],
          freeProvider: false,
          category: "unknown",
        },
  };
}

export function checkDisposable(
  parsed: ParsedEmail,
  options: ValidateEmailOptions,
): { check: DisposableCheck } {
  const normalized = normalizeDomain(parsed.asciiDomain);
  const allowed = createDomainSet(options.datasets?.allowedDisposableDomains ?? []);
  if (allowed.has(normalized)) {
    return {
      check: {
        status: "pass",
        reasons: ["allowlisted"],
        disposable: false,
        category: "allowlisted",
      },
    };
  }
  const disposable = buildDisposableDomainSet(options).has(normalized);
  return {
    check: disposable
      ? {
          status: "warning",
          reasons: ["disposable"],
          disposable: true,
          category: "disposable",
          source: "built_in",
        }
      : {
          status: "pass",
          reasons: [],
          disposable: false,
          category: "unknown",
        },
  };
}

function buildFreeDomainSet(options: ValidateEmailOptions): Set<string> {
  const configured = options.datasets?.freeDomains;
  if (configured?.mode === "replace") return createDomainSet(configured.domains);
  if (!configured?.domains) return builtInFreeDomainSet();
  return createDomainSet([...builtInFreeDomains(), ...configured.domains]);
}

function buildDisposableDomainSet(options: ValidateEmailOptions): Set<string> {
  const configured = options.datasets?.disposableDomains;
  const blocked = options.datasets?.blockedDisposableDomains ?? [];
  if (configured?.mode === "replace") {
    return createDomainSet([...configured.domains, ...blocked]);
  }
  if (!configured?.domains && !options.datasets?.blockedDisposableDomains) {
    return builtInDisposableDomainSet();
  }
  return createDomainSet([...builtInDisposableDomains(), ...(configured?.domains ?? []), ...blocked]);
}

function normalizeDomain(domain: string): string {
  return normalizeDomainName(domain);
}

function builtInFreeDomains(): string[] {
  freeDomains ??= FREE_DOMAIN_DATA.split("\n");
  return freeDomains;
}

function builtInDisposableDomains(): string[] {
  disposableDomains ??= DISPOSABLE_DOMAIN_DATA.split("\n");
  return disposableDomains;
}

function builtInFreeDomainSet(): Set<string> {
  freeDomainSet ??= createDomainSet(builtInFreeDomains());
  return freeDomainSet;
}

function builtInDisposableDomainSet(): Set<string> {
  disposableDomainSet ??= createDomainSet(builtInDisposableDomains());
  return disposableDomainSet;
}
