import { defaultDnsResolver } from "./dns.js";
import { defaultSmtpConnector } from "./smtp.js";
import { createEmailValidator } from "./validator.js";
import type {
  EmailDnsResolver,
  EmailIssueStage,
  EmailSmtpConnector,
  EmailValidationResult,
  ResolveOptions,
  SmtpConnection,
  ValidateEmailOptions,
  ValidateEmailsOptions,
  ValidateEmailsResult,
} from "./types.js";

export async function validateEmails(
  emails: string[],
  options: ValidateEmailsOptions = {},
): Promise<ValidateEmailsResult> {
  const { batch, ...baseValidationOptions } = options;
  const validationOptions = withBatchConcurrency(baseValidationOptions, {
    ...(batch?.dnsConcurrency !== undefined ? { dns: batch.dnsConcurrency } : {}),
    ...(batch?.smtpConcurrency !== undefined ? { smtp: batch.smtpConcurrency } : {}),
  });
  const validator = createEmailValidator(validationOptions);
  const concurrency = Math.max(1, batch?.concurrency ?? 10);
  const results: EmailValidationResult[] = new Array(emails.length);
  let next = 0;

  async function worker() {
    while (next < emails.length) {
      const index = next;
      next += 1;
      results[index] = await validator.validateEmail(emails[index]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, emails.length) }, worker));
  return summarize(results);
}

function withBatchConcurrency(
  options: ValidateEmailOptions,
  concurrency: { dns?: number; smtp?: number },
): ValidateEmailOptions {
  if (concurrency.dns === undefined && concurrency.smtp === undefined) return options;
  return {
    ...options,
    ...(concurrency.dns !== undefined
      ? {
          dns: {
            ...options.dns,
            resolver: limitDnsResolver(options.dns?.resolver ?? defaultDnsResolver, concurrency.dns),
          },
        }
      : {}),
    ...(concurrency.smtp !== undefined
      ? {
          smtp: {
            ...options.smtp,
            connector: limitSmtpConnector(
              options.smtp?.connector ?? defaultSmtpConnector,
              concurrency.smtp,
            ),
          },
        }
      : {}),
  };
}

function limitDnsResolver(resolver: EmailDnsResolver, concurrency: number): EmailDnsResolver {
  const run = createLimiter(Math.max(1, concurrency));
  return {
    resolveMx(domain, options) {
      return run(() => resolver.resolveMx(domain, options));
    },
    resolve4(domain, options) {
      return run(() => resolver.resolve4(domain, options));
    },
    resolve6(domain, options) {
      return run(() => resolver.resolve6(domain, options));
    },
    ...(resolver.lookup
      ? {
          lookup(hostname, options) {
            return run(() => resolver.lookup!(hostname, options));
          },
        }
      : {}),
  };
}

function limitSmtpConnector(
  connector: EmailSmtpConnector,
  concurrency: number,
): EmailSmtpConnector {
  const semaphore = createSemaphore(Math.max(1, concurrency));
  return {
    async connect(host, port, options) {
      const release = await semaphore.acquire();
      try {
        const connection = await connector.connect(host, port, options);
        return wrapLimitedSmtpConnection(connection, release);
      } catch (error) {
        release();
        throw error;
      }
    },
  };
}

function wrapLimitedSmtpConnection(
  connection: SmtpConnection,
  release: () => void,
): SmtpConnection {
  let released = false;
  const releaseOnce = () => {
    if (!released) {
      released = true;
      release();
    }
  };
  return {
    get remoteAddress() {
      return connection.remoteAddress;
    },
    readLine(options?: ResolveOptions) {
      return connection.readLine(options);
    },
    writeLine(line: string, options?: ResolveOptions) {
      return connection.writeLine(line, options);
    },
    ...(connection.startTls
      ? {
          async startTls(serverName: string, options?: ResolveOptions) {
            const upgraded = await connection.startTls!(serverName, options);
            return wrapLimitedSmtpConnection(upgraded, releaseOnce);
          },
        }
      : {}),
    async close() {
      try {
        await connection.close();
      } finally {
        releaseOnce();
      }
    },
  };
}

function createSemaphore(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  return {
    async acquire(): Promise<() => void> {
      if (active >= concurrency) {
        await new Promise<void>((resolve) => queue.push(resolve));
      }
      active += 1;
      return () => {
        active -= 1;
        queue.shift()?.();
      };
    },
  };
}

function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  return async function runLimited<T>(operation: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await operation();
    } finally {
      active -= 1;
      queue.shift()?.();
    }
  };
}

function summarize(results: EmailValidationResult[]): ValidateEmailsResult {
  const byStage: Record<EmailIssueStage, number> = {
    syntax: 0,
    normalization: 0,
    dns: 0,
    typo: 0,
    disposable: 0,
    freeProvider: 0,
    smtp: 0,
    policy: 0,
  };
  const byCode: Record<string, number> = {};
  for (const result of results) {
    for (const entry of result.issues) {
      byStage[entry.stage] += 1;
      byCode[entry.code] = (byCode[entry.code] ?? 0) + 1;
    }
  }
  return {
    results,
    summary: {
      total: results.length,
      accepted: results.filter((result) => result.valid).length,
      rejected: results.filter((result) => !result.valid).length,
      byStage,
      byCode,
    },
  };
}
