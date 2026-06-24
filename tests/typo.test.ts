import { describe, expect, test } from "bun:test";
import { validateEmail } from "../src/index.js";

const noRecordsResolver = {
  async resolveMx() {
    return [];
  },
  async resolve4() {
    return [];
  },
  async resolve6() {
    return [];
  },
};

const deliverableResolver = {
  async resolveMx() {
    return [{ exchange: "mx.example.com", priority: 1 }];
  },
  async resolve4() {
    return [];
  },
  async resolve6() {
    return [];
  },
};

describe("typo checks", () => {
  test("suggests close common-domain corrections only when enabled", async () => {
    const result = await validateEmail("user@gmial.com", {
      checks: { dns: false, typo: true },
    });

    expect(result.valid).toBe(true);
    expect(result.checks.typo.status).toBe("warning");
    expect(result.checks.typo.suggestion).toBe("user@gmail.com");
    expect(result.checks.typo.confidence).toBeGreaterThan(0.7);
  });

  test("blockTypo policy enables the check and blocks suspected typos", async () => {
    const result = await validateEmail("user@gmial.com", {
      checks: { dns: false },
      policy: { blockTypo: true },
    });

    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("email.typo.blocked");
  });

  test("does not suggest for deliverable domains unless explicitly requested", async () => {
    const quiet = await validateEmail("user@gmial.com", {
      checks: { typo: true },
      dns: { resolver: deliverableResolver },
    });
    const explicit = await validateEmail("user@gmial.com", {
      checks: { typo: true },
      dns: { resolver: deliverableResolver },
      typo: { suggestEvenWhenDeliverable: true },
    });

    expect(quiet.checks.typo.status).toBe("pass");
    expect(quiet.checks.typo.suggestion).toBeUndefined();
    expect(explicit.checks.typo.status).toBe("warning");
    expect(explicit.checks.typo.suggestion).toBe("user@gmail.com");
  });

  test("caller common domains extend typo suggestions", async () => {
    const result = await validateEmail("user@acmecorp.cmo", {
      checks: { typo: true },
      dns: { resolver: noRecordsResolver },
      typo: { commonDomains: ["acmecorp.com"] },
      policy: { requireDnsDeliverable: false },
    });

    expect(result.checks.typo.status).toBe("warning");
    expect(result.checks.typo.suggestion).toBe("user@acmecorp.com");
  });

  test("typo ranking prefers lower edit distance before shorter candidate", async () => {
    const result = await validateEmail("u@abcde.com", {
      checks: { dns: false, typo: true },
      typo: { commonDomains: ["abcdef.com", "abc.com"] },
    });

    expect(result.checks.typo.suggestion).toBe("u@abcdef.com");
  });
});
