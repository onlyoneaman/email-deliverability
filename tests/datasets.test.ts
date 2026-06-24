import { describe, expect, test } from "bun:test";
import {
  getDatasetInfo,
  getDisposableEmailDomains,
  getFreeEmailDomains,
  isDisposableEmailDomain,
  isFreeEmailDomain,
  validateEmail,
} from "../src/index.js";

const deliverableResolver = {
  async resolveMx() {
    return [{ exchange: "mx.example.com", priority: 10 }];
  },
  async resolve4() {
    return [];
  },
  async resolve6() {
    return [];
  },
};

describe("free-provider and disposable datasets", () => {
  test("exports compact built-in free and disposable domain lists with metadata", () => {
    expect(getFreeEmailDomains()).toContain("gmail.com");
    expect(getDisposableEmailDomains()).toContain("mailinator.com");
    expect(isFreeEmailDomain("GMAIL.COM")).toBe(true);
    expect(isFreeEmailDomain("ｇｍａｉｌ.com")).toBe(true);
    expect(isDisposableEmailDomain("Mailinator.com")).toBe(true);

    const info = getDatasetInfo();
    expect(info.sources.length).toBe(2);
    expect(info.counts.free).toBeGreaterThan(7_000);
    expect(info.counts.disposable).toBeGreaterThan(5_000);
    expect(info.sources[0]).toMatchObject({
      name: "free-email-domains",
      license: "MIT",
      exactCount: info.counts.free,
      exclusionsCount: info.counts.disposable,
    });
    expect(info.sources[1]).toMatchObject({
      name: "disposable-email-domains-js",
      license: "CC0-1.0",
      exactCount: info.counts.disposable,
    });
    const disposable = new Set(getDisposableEmailDomains());
    const overlap = getFreeEmailDomains().filter((domain) => disposable.has(domain));
    expect(overlap).toEqual([]);
  });

  test("free-provider check warns and business-email policy blocks", async () => {
    const warning = await validateEmail("a@gmail.com", {
      checks: { dns: false, freeProvider: true },
    });
    const blocked = await validateEmail("a@gmail.com", {
      checks: { dns: false },
      policy: { requireBusinessEmail: true },
    });

    expect(warning.valid).toBe(true);
    expect(warning.checks.freeProvider.status).toBe("warning");
    expect(warning.checks.freeProvider.freeProvider).toBe(true);
    expect(blocked.valid).toBe(false);
    expect(blocked.issues[0]?.code).toBe("email.free_provider.blocked");
  });

  test("disposable check warns and blockDisposable policy blocks", async () => {
    const warning = await validateEmail("a@mailinator.com", {
      checks: { dns: false, disposable: true },
    });
    const blocked = await validateEmail("a@mailinator.com", {
      checks: { dns: false },
      policy: { blockDisposable: true },
    });

    expect(warning.valid).toBe(true);
    expect(warning.checks.disposable.status).toBe("warning");
    expect(warning.checks.disposable.disposable).toBe(true);
    expect(blocked.valid).toBe(false);
    expect(blocked.issues[0]?.code).toBe("email.disposable.blocked");
  });

  test("caller datasets can extend, replace, allow, and block domains", async () => {
    const extended = await validateEmail("a@custom-temp.test", {
      checks: { dns: false, disposable: true },
      policy: { allowSpecialUseDomains: true },
      datasets: {
        disposableDomains: { domains: ["custom-temp.test"] },
      },
    });
    const replaced = await validateEmail("a@mailinator.com", {
      checks: { dns: false, disposable: true },
      datasets: {
        disposableDomains: { mode: "replace", domains: ["only.test"] },
      },
    });
    const allowed = await validateEmail("a@mailinator.com", {
      checks: { dns: false },
      policy: { blockDisposable: true },
      datasets: {
        allowedDisposableDomains: ["mailinator.com"],
      },
    });
    const locallyBlocked = await validateEmail("a@example.com", {
      checks: { dns: false, disposable: true },
      policy: { allowSpecialUseDomains: true },
      datasets: {
        blockedDisposableDomains: ["example.com"],
      },
    });

    expect(extended.checks.disposable.disposable).toBe(true);
    expect(replaced.checks.disposable.disposable).toBe(false);
    expect(allowed.valid).toBe(true);
    expect(allowed.checks.disposable.category).toBe("allowlisted");
    expect(locallyBlocked.checks.disposable.disposable).toBe(true);
  });

  test("dataset checks run after DNS without forcing network when DNS disabled", async () => {
    const result = await validateEmail("a@gmail.com", {
      checks: { dns: true, freeProvider: true },
      dns: { resolver: deliverableResolver },
    });

    expect(result.valid).toBe(true);
    expect(result.checks.dns.status).toBe("pass");
    expect(result.checks.freeProvider.status).toBe("warning");
  });
});
