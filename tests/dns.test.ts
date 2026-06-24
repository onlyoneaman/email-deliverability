import { describe, expect, test } from "bun:test";
import {
  checkDomainDeliverability,
  checkEmailDomainDeliverability,
  createEmailValidator,
  validateEmail,
} from "../src/index.js";
import type { EmailDnsResolver, ResolveOptions } from "../src/types.js";

function resolver(records: {
  mx?: Array<{ exchange: string; priority: number }>;
  a?: string[];
  aaaa?: string[];
  failMx?: Error;
  failA?: Error;
  failAaaa?: Error;
}): EmailDnsResolver {
  return {
    async resolveMx(_domain: string, options?: ResolveOptions) {
      options?.signal?.throwIfAborted();
      if (records.failMx) throw records.failMx;
      return records.mx ?? [];
    },
    async resolve4(_domain: string, options?: ResolveOptions) {
      options?.signal?.throwIfAborted();
      if (records.failA) throw records.failA;
      return records.a ?? [];
    },
    async resolve6(_domain: string, options?: ResolveOptions) {
      options?.signal?.throwIfAborted();
      if (records.failAaaa) throw records.failAaaa;
      return records.aaaa ?? [];
    },
  };
}

function dnsError(code: string): Error {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  return error;
}

describe("DNS deliverability", () => {
  test("uses injected resolver and passes when MX records exist", async () => {
    const result = await validateEmail("a@example.com", {
      dns: { resolver: resolver({ mx: [{ exchange: "mx.example.com", priority: 10 }] }) },
      policy: { allowSpecialUseDomains: true },
    });

    expect(result.valid).toBe(true);
    expect(result.checks.dns.status).toBe("pass");
    expect(result.checks.dns.deliverability).toBe("deliverable");
    expect(result.checks.dns.reasons).toEqual(["mx_found"]);
    expect(result.checks.dns.mxRecords).toEqual([
      { exchange: "mx.example.com", priority: 10 },
    ]);
  });

  test("detects RFC Null MX as undeliverable and blocks by default", async () => {
    const result = await validateEmail("a@example.com", {
      dns: { resolver: resolver({ mx: [{ exchange: ".", priority: 0 }] }) },
      policy: { allowSpecialUseDomains: true },
    });

    expect(result.valid).toBe(false);
    expect(result.checks.dns.status).toBe("fail");
    expect(result.checks.dns.deliverability).toBe("undeliverable");
    expect(result.issues[0]?.code).toBe("email.dns.null_mx");
  });

  test("detects Node normalized empty-string Null MX exchange", async () => {
    const result = await validateEmail("a@example.com", {
      dns: { resolver: resolver({ mx: [{ exchange: "", priority: 0 }] }) },
      policy: { allowSpecialUseDomains: true },
    });

    expect(result.valid).toBe(false);
    expect(result.checks.dns.reasons).toEqual(["null_mx"]);
  });

  test("treats malformed empty-string Null MX as risky instead of deliverable", async () => {
    const result = await validateEmail("a@example.com", {
      dns: {
        resolver: resolver({
          mx: [
            { exchange: "", priority: 10 },
            { exchange: "mx.example.com", priority: 20 },
          ],
        }),
      },
      policy: { allowSpecialUseDomains: true },
    });

    expect(result.valid).toBe(true);
    expect(result.checks.dns.status).toBe("warning");
    expect(result.checks.dns.deliverability).toBe("risky");
    expect(result.issues[0]?.code).toBe("email.dns.malformed_null_mx");
  });

  test("uses A fallback when MX records are absent", async () => {
    const result = await validateEmail("a@example.com", {
      dns: { resolver: resolver({ a: ["203.0.113.10"] }) },
      policy: { allowSpecialUseDomains: true },
    });

    expect(result.valid).toBe(true);
    expect(result.checks.dns.status).toBe("pass");
    expect(result.checks.dns.reasons).toEqual(["no_mx", "fallback_a"]);
  });

  test("treats ENODATA MX as no MX and still checks A/AAAA fallback", async () => {
    const result = await validateEmail("a@example.com", {
      dns: { resolver: resolver({ failMx: dnsError("ENODATA"), a: ["203.0.113.10"] }) },
      policy: { allowSpecialUseDomains: true },
    });

    expect(result.valid).toBe(true);
    expect(result.checks.dns.status).toBe("pass");
    expect(result.checks.dns.reasons).toEqual(["no_mx", "fallback_a"]);
  });

  test("treats ENODATA per A/AAAA record type as an empty fallback result", async () => {
    const result = await validateEmail("a@example.com", {
      dns: {
        resolver: resolver({
          failA: dnsError("ENODATA"),
          aaaa: ["2001:db8::1"],
        }),
      },
      policy: { allowSpecialUseDomains: true },
    });

    expect(result.valid).toBe(true);
    expect(result.checks.dns.status).toBe("pass");
    expect(result.checks.dns.reasons).toEqual(["no_mx", "fallback_aaaa"]);
  });

  test("no MX and no A or AAAA records is undeliverable", async () => {
    const result = await validateEmail("a@example.com", {
      dns: { resolver: resolver({}) },
      policy: { allowSpecialUseDomains: true },
    });

    expect(result.valid).toBe(false);
    expect(result.checks.dns.status).toBe("fail");
    expect(result.checks.dns.deliverability).toBe("undeliverable");
    expect(result.issues[0]?.code).toBe("email.dns.no_mail_records");
  });

  test("hard DNS failures can be reported without blocking when policy disables DNS deliverability", async () => {
    const nullMx = await validateEmail("a@example.com", {
      dns: { resolver: resolver({ mx: [{ exchange: ".", priority: 0 }] }) },
      policy: { allowSpecialUseDomains: true, requireDnsDeliverable: false },
    });
    const noRecords = await validateEmail("a@example.com", {
      dns: { resolver: resolver({}) },
      policy: { allowSpecialUseDomains: true, requireDnsDeliverable: false },
    });
    const notFound = await validateEmail("a@example.com", {
      dns: { resolver: resolver({ failMx: dnsError("ENOTFOUND") }) },
      policy: { allowSpecialUseDomains: true, requireDnsDeliverable: false },
    });

    expect(nullMx.valid).toBe(true);
    expect(nullMx.issues[0]?.affectsValidity).toBe(false);
    expect(noRecords.valid).toBe(true);
    expect(noRecords.issues[0]?.affectsValidity).toBe(false);
    expect(notFound.valid).toBe(true);
    expect(notFound.issues[0]?.affectsValidity).toBe(false);
  });

  test("DNS errors are warnings unless strict deliverability is required", async () => {
    const loose = await validateEmail("a@example.com", {
      dns: { resolver: resolver({ failMx: new Error("SERVFAIL") }) },
      policy: { allowSpecialUseDomains: true },
    });
    const strict = await validateEmail("a@example.com", {
      dns: { resolver: resolver({ failMx: new Error("SERVFAIL") }) },
      policy: { allowSpecialUseDomains: true, requireDnsDeliverable: "strict" },
    });

    expect(loose.valid).toBe(true);
    expect(loose.checks.dns.status).toBe("error");
    expect(loose.issues[0]?.affectsValidity).toBe(false);
    expect(strict.valid).toBe(false);
    expect(strict.issues[0]?.code).toBe("email.dns.error");
  });

  test("checks.dns false skips resolver calls", async () => {
    let calls = 0;
    const result = await validateEmail("a@example.com", {
      checks: { dns: false },
      dns: {
        resolver: {
          async resolveMx() {
            calls += 1;
            return [];
          },
          async resolve4() {
            calls += 1;
            return [];
          },
          async resolve6() {
            calls += 1;
            return [];
          },
        },
      },
      policy: { allowSpecialUseDomains: true },
    });

    expect(result.valid).toBe(true);
    expect(calls).toBe(0);
    expect(result.checks.dns.status).toBe("not_checked");
  });

  test("package-level timeout applies to injected resolvers", async () => {
    const result = await validateEmail("a@example.com", {
      dns: {
        timeoutMs: 1,
        resolver: {
          async resolveMx() {
            await new Promise((resolve) => setTimeout(resolve, 30));
            return [{ exchange: "mx.example.com", priority: 1 }];
          },
          async resolve4() {
            return [];
          },
          async resolve6() {
            return [];
          },
        },
      },
      policy: { allowSpecialUseDomains: true },
    });

    expect(result.valid).toBe(true);
    expect(result.checks.dns.status).toBe("timeout");
    expect(result.issues[0]?.code).toBe("email.dns.timeout");
  });

  test("total validation timeout applies to DNS work", async () => {
    const result = await validateEmail("a@example.com", {
      timeout: { totalMs: 1 },
      dns: {
        resolver: {
          async resolveMx() {
            await new Promise((resolve) => setTimeout(resolve, 30));
            return [{ exchange: "mx.example.com", priority: 1 }];
          },
          async resolve4() {
            return [];
          },
          async resolve6() {
            return [];
          },
        },
      },
      policy: { allowSpecialUseDomains: true },
    });

    expect(result.valid).toBe(true);
    expect(result.checks.dns.status).toBe("timeout");
    expect(result.issues[0]?.code).toBe("email.dns.timeout");
  });

  test("domain deliverability helpers expose DNS-only checks", async () => {
    const dns = { resolver: resolver({ mx: [{ exchange: "mx.example.com", priority: 1 }] }) };

    expect((await checkDomainDeliverability("example.com", { dns })).status).toBe("pass");
    expect((await checkEmailDomainDeliverability("a@example.com", { dns })).status).toBe(
      "pass",
    );
  });

  test("createEmailValidator shares cache across calls", async () => {
    let mxCalls = 0;
    const validator = createEmailValidator({
      dns: {
        resolver: {
          async resolveMx() {
            mxCalls += 1;
            return [{ exchange: "mx.example.com", priority: 1 }];
          },
          async resolve4() {
            return [];
          },
          async resolve6() {
            return [];
          },
        },
      },
      policy: { allowSpecialUseDomains: true },
    });

    await validator.validateEmail("a@example.com");
    await validator.validateEmail("b@example.com");

    expect(mxCalls).toBe(1);
  });

  test("built-in validator cache is bounded", async () => {
    let mxCalls = 0;
    const validator = createEmailValidator({
      dns: {
        resolver: {
          async resolveMx(domain) {
            mxCalls += 1;
            return [{ exchange: `mx.${domain}`, priority: 1 }];
          },
          async resolve4() {
            return [];
          },
          async resolve6() {
            return [];
          },
        },
      },
      policy: { allowSpecialUseDomains: true },
    });

    for (let index = 0; index < 260; index += 1) {
      await validator.validateEmail(`a@domain-${index}.com`);
    }
    await validator.validateEmail("a@domain-1.com");

    expect(mxCalls).toBe(261);
  });
});
