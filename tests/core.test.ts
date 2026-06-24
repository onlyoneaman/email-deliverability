import { describe, expect, test } from "bun:test";
import {
  isEmailSyntaxValid,
  isValidEmail,
  parseEmail,
  validateEmail,
} from "../src/index.js";
import { assertValidEmail } from "../src/index.js";
import * as browserEntry from "../src/browser.js";
import * as syntaxEntry from "../src/syntax.js";

describe("core parsing and result model", () => {
  test("normalizes domain while preserving local part semantics", async () => {
    const result = await validateEmail("User+tag@Example.COM", {
      checks: { dns: false },
    });

    expect(result.valid).toBe(true);
    expect(result.decision.accepted).toBe(true);
    expect(result.status).toBe("unknown");
    expect(result.reason).toBe("inconclusive");
    expect(result.recommendation).toBe("accept");
    expect(result.parsed).toEqual({
      normalized: "User+tag@example.com",
      local: "User+tag",
      domain: "example.com",
      asciiDomain: "example.com",
      asciiEmail: "User+tag@example.com",
      smtputf8: false,
    });
    expect(result.checks.syntax.status).toBe("pass");
    expect(result.checks.dns.status).toBe("not_checked");
    expect(result.checks.smtp.status).toBe("not_checked");
    expect(result.issues).toEqual([]);
  });

  test("returns structured syntax issues without throwing", async () => {
    const result = await validateEmail("bad@@example.com", {
      checks: { dns: false },
    });

    expect(result.valid).toBe(false);
    expect(result.status).toBe("undeliverable");
    expect(result.reason).toBe("invalid_syntax");
    expect(result.recommendation).toBe("reject");
    expect(result.parsed).toBeUndefined();
    expect(result.checks.syntax.status).toBe("fail");
    expect(result.decision.blockedBy).toEqual([
      { policy: "syntax", issueCode: "email.syntax.too_many_at" },
    ]);
    expect(result.issues[0]).toMatchObject({
      code: "email.syntax.too_many_at",
      stage: "syntax",
      severity: "error",
      path: ["input"],
      affectsValidity: true,
    });
  });

  test("parseEmail only parses and does not enforce public-domain account policy", () => {
    const parsed = parseEmail("dev@localhost", {
      policy: { requirePublicInternetDomain: true, allowSpecialUseDomains: false },
    });

    expect(parsed.valid).toBe(true);
    expect(parsed.parsed?.normalized).toBe("dev@localhost");
    expect(parsed.checks.dns.status).toBe("not_checked");
    expect(parsed.decision.accepted).toBe(true);
  });

  test("validateEmail rejects special-use domains unless explicitly allowed", async () => {
    const blocked = await validateEmail("dev@example.test", {
      checks: { dns: false },
    });
    const allowed = await validateEmail("dev@example.test", {
      checks: { dns: false },
      policy: { allowSpecialUseDomains: true },
    });

    expect(blocked.valid).toBe(false);
    expect(blocked.status).toBe("undeliverable");
    expect(blocked.reason).toBe("not_public_domain");
    expect(blocked.recommendation).toBe("reject");
    expect(blocked.issues.map((issue) => issue.code)).toContain(
      "email.policy.special_use_domain",
    );
    expect(blocked.decision.blockedBy[0]?.policy).toBe("allowSpecialUseDomains");
    expect(allowed.valid).toBe(true);
  });

  test("supports display-name and quoted local parts only when enabled", () => {
    expect(parseEmail("Jane <jane@example.com>").valid).toBe(false);
    expect(
      parseEmail("Jane <jane@example.com>", {
        syntax: { allowDisplayName: true },
      }).parsed?.normalized,
    ).toBe("jane@example.com");

    expect(parseEmail('"a b"@example.com').valid).toBe(false);
    expect(
      parseEmail('"a b"@example.com', {
        syntax: { allowQuotedLocal: true },
      }).parsed?.local,
    ).toBe('"a b"');
  });

  test("rejects display-name input with trailing garbage", () => {
    const result = parseEmail("Jane <jane@example.com> garbage", {
      syntax: { allowDisplayName: true },
    });

    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("email.syntax.invalid_display_name");
  });

  test("validates domain literals when explicitly allowed", () => {
    expect(
      parseEmail("a@[192.0.2.1]", {
        syntax: { allowDomainLiteral: true },
      }).valid,
    ).toBe(true);
    expect(
      parseEmail("a@[not a literal]", {
        syntax: { allowDomainLiteral: true },
      }).issues[0]?.code,
    ).toBe("email.syntax.invalid_domain_literal");
    expect(
      parseEmail("a@[999.999.999.999]", {
        syntax: { allowDomainLiteral: true },
      }).issues[0]?.code,
    ).toBe("email.syntax.invalid_domain_literal");
  });

  test("supports localized messages with region fallback", async () => {
    const result = await validateEmail("bad@@example.com", {
      checks: { dns: false },
      locale: "es-MX",
    });

    expect(result.issues[0]?.message).toContain("demasiados signos");
  });

  test("boolean and throwing helpers are derived from the same result", async () => {
    expect(isEmailSyntaxValid("a@example.com")).toBe(true);
    expect(isEmailSyntaxValid("a@@example.com")).toBe(false);
    expect(await isValidEmail("a@example.com", { checks: { dns: false } })).toBe(
      true,
    );
    await expect(
      assertValidEmail("a@@example.com", { checks: { dns: false } }),
    ).rejects.toThrow("email.syntax.too_many_at");
  });

  test("async assertion wrapper enforces validation policy", async () => {
    await expect(
      assertValidEmail("dev@example.test", { checks: { dns: false } }),
    ).rejects.toThrow("email.policy.special_use_domain");
  });

  test("rejects invalid domain forms instead of accepting URL host parsing", () => {
    expect(parseEmail("a@example.com:80").issues[0]?.code).toBe(
      "email.syntax.invalid_domain",
    );
    expect(parseEmail("a@-example.com").issues[0]?.code).toBe(
      "email.syntax.invalid_domain",
    );
    expect(parseEmail("a@example-.com").issues[0]?.code).toBe(
      "email.syntax.invalid_domain",
    );
  });

  test("honors allowSmtputf8 false for unicode local parts", () => {
    const result = parseEmail("ü@example.com", {
      syntax: { allowSmtputf8: false },
    });

    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("email.syntax.smtputf8_not_allowed");
  });

  test("strict unicode security accepts only ASCII addr-specs", () => {
    const unicodeLocal = parseEmail("ü@example.com", {
      syntax: { unicodeSecurity: "strict" },
    });
    const unicodeDomain = parseEmail("a@exämple.com", {
      syntax: { unicodeSecurity: "strict" },
    });

    expect(unicodeLocal.valid).toBe(false);
    expect(unicodeLocal.issues[0]?.code).toBe("email.syntax.unicode_security");
    expect(unicodeDomain.valid).toBe(false);
    expect(unicodeDomain.issues[0]?.code).toBe("email.syntax.unicode_security");
  });

  test("syntax and browser entrypoints preserve runtime boundaries", () => {
    expect(syntaxEntry.parseEmail("a@example.com").valid).toBe(true);
    expect("validateEmail" in syntaxEntry).toBe(false);
    expect("probeSmtp" in browserEntry).toBe(false);
    expect(browserEntry.parseEmail("a@example.com").valid).toBe(true);
  });

  test("required DNS policy cannot silently accept a disabled DNS check", async () => {
    const dns = await validateEmail("a@example.com", {
      checks: { dns: false },
      policy: { requireDnsDeliverable: true, allowSpecialUseDomains: true },
    });

    expect(dns.valid).toBe(false);
    expect(dns.status).toBe("unknown");
    expect(dns.reason).toBe("inconclusive");
    expect(dns.recommendation).toBe("verify");
    expect(dns.issues[0]?.code).toBe("email.dns.not_checked");
  });
});
