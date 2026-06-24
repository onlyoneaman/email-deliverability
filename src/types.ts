export type CheckStatus =
  | "not_checked"
  | "pass"
  | "fail"
  | "warning"
  | "unknown"
  | "timeout"
  | "error";

export type EmailIssueStage =
  | "syntax"
  | "normalization"
  | "dns"
  | "typo"
  | "disposable"
  | "freeProvider"
  | "smtp"
  | "policy";

export type EmailIssue = {
  code: string;
  stage: EmailIssueStage;
  severity: "error" | "warning" | "info";
  message: string;
  path?: Array<string | number>;
  params?: Record<string, unknown>;
  affectsValidity: boolean;
};

export type CheckBase = {
  status: CheckStatus;
  reasons: string[];
  durationMs?: number;
};

export type SyntaxCheck = CheckBase & {
  status: "pass" | "fail";
};

export type DnsDeliverabilityCheck = CheckBase & {
  status: "not_checked" | "pass" | "fail" | "warning" | "unknown" | "timeout" | "error";
  deliverability?: "deliverable" | "undeliverable" | "risky" | "unknown";
  mxRecords?: Array<{ exchange: string; priority: number }>;
};

export type TypoCheck = CheckBase & {
  status: "not_checked" | "pass" | "warning";
  suggestion?: string;
  confidence?: number;
};

export type DisposableCheck = CheckBase & {
  status: "not_checked" | "pass" | "warning" | "fail";
  disposable?: boolean;
  category?: "disposable" | "allowlisted" | "unknown";
  source?: string;
};

export type FreeProviderCheck = CheckBase & {
  status: "not_checked" | "pass" | "warning" | "fail";
  freeProvider?: boolean;
  category?: "free_provider" | "unknown";
  source?: string;
};

export type SmtpProbeCheck = CheckBase & {
  status: "not_checked" | "pass" | "fail" | "warning" | "unknown" | "timeout" | "error";
  valid?: true | false | null;
};

export type ParsedEmail = {
  normalized: string;
  local: string;
  domain: string;
  asciiDomain: string;
  asciiEmail: string | null;
  smtputf8: boolean;
};

export type EmailValidationResult = {
  input: string;
  valid: boolean;
  parsed?: ParsedEmail;
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
      policy:
        | "syntax"
        | "dns"
        | "blockTypo"
        | "blockDisposable"
        | "requireBusinessEmail"
        | "blockOnSmtpRejection"
        | "requirePublicInternetDomain"
        | "allowSpecialUseDomains";
      issueCode: string;
    }>;
  };
};

export type SupportedLocale =
  | "en"
  | "es"
  | "fr"
  | "de"
  | "pt-BR"
  | "hi"
  | "ja"
  | "zh-CN";

export type EmailDnsResolver = {
  resolveMx(
    domain: string,
    options?: ResolveOptions,
  ): Promise<Array<{ exchange: string; priority: number }>>;
  resolve4(domain: string, options?: ResolveOptions): Promise<string[]>;
  resolve6(domain: string, options?: ResolveOptions): Promise<string[]>;
  lookup?(
    hostname: string,
    options?: ResolveOptions,
  ): Promise<Array<{ address: string; family: 4 | 6 }>>;
};

export type ResolveOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type SmtpConnection = {
  readonly remoteAddress?: string | undefined;
  readLine(options?: ResolveOptions): Promise<string>;
  writeLine(line: string, options?: ResolveOptions): Promise<void>;
  startTls?(serverName: string, options?: ResolveOptions): Promise<SmtpConnection>;
  close(): Promise<void> | void;
};

export type EmailSmtpConnector = {
  connect(
    host: string,
    port: number,
    options?: ResolveOptions & { tls?: boolean; serverName?: string },
  ): Promise<SmtpConnection>;
};

export type EmailValidationCache = {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs?: number): void;
};

export type SmtpProbeOptions = {
  sender?: string;
  heloName?: string;
  timeoutMs?: number;
  port?: number;
  tls?: "disable" | "opportunistic" | "require";
  allowPrivateNetworks?: boolean;
  detectCatchAll?: boolean;
  catchAllAddressFactory?: () => string;
  connector?: EmailSmtpConnector;
};

export type ValidateEmailOptions = {
  checks?: {
    dns?: boolean;
    typo?: boolean;
    disposable?: boolean;
    freeProvider?: boolean;
    smtp?: boolean;
  };
  syntax?: {
    mode?: "account" | "rfc";
    unicodeSecurity?: "standard" | "strict";
    allowDisplayName?: boolean;
    allowQuotedLocal?: boolean;
    allowDomainLiteral?: boolean;
    allowEmptyLocal?: boolean;
    allowSmtputf8?: boolean;
  };
  policy?: {
    requirePublicInternetDomain?: boolean;
    allowSpecialUseDomains?: boolean;
    requireDnsDeliverable?: boolean | "strict";
    blockTypo?: boolean;
    blockDisposable?: boolean;
    requireBusinessEmail?: boolean;
    blockOnSmtpRejection?: boolean;
  };
  dns?: {
    timeoutMs?: number;
    resolver?: EmailDnsResolver;
    cache?: EmailValidationCache | false;
  };
  smtp?: SmtpProbeOptions;
  typo?: {
    suggestEvenWhenDeliverable?: boolean;
    commonDomains?: Iterable<string>;
  };
  datasets?: {
    commonDomains?: string[];
    freeDomains?: {
      mode?: "extend" | "replace";
      domains: Iterable<string>;
    };
    disposableDomains?: {
      mode?: "extend" | "replace";
      domains: Iterable<string>;
    };
    allowedDisposableDomains?: Iterable<string>;
    blockedDisposableDomains?: Iterable<string>;
  };
  timeout?: {
    totalMs?: number;
  };
  locale?: SupportedLocale | (string & {});
  signal?: AbortSignal;
};

export type ParseEmailOptions = Pick<ValidateEmailOptions, "syntax" | "policy" | "locale">;

export type ValidateEmailsOptions = ValidateEmailOptions & {
  batch?: {
    concurrency?: number;
    dnsConcurrency?: number;
    smtpConcurrency?: number;
  };
};

export type ValidateEmailsResult = {
  results: EmailValidationResult[];
  summary: {
    total: number;
    accepted: number;
    rejected: number;
    byStage: Record<EmailIssueStage, number>;
    byCode: Record<string, number>;
  };
};
