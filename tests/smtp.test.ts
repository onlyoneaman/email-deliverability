import { describe, expect, test } from "bun:test";
import { probeSmtp, validateEmail } from "../src/index.js";
import type { EmailDnsResolver, EmailSmtpConnector, ResolveOptions } from "../src/types.js";

function mxResolver(exchange = "mx.example.com"): EmailDnsResolver {
  return {
    async resolveMx() {
      return [{ exchange, priority: 1 }];
    },
    async resolve4() {
      return [];
    },
    async resolve6() {
      return [];
    },
    async lookup(_hostname: string, _options?: ResolveOptions) {
      return [{ address: "93.184.216.34", family: 4 }];
    },
  };
}

function scriptedConnector(responses: string[]) {
  const writes: string[] = [];
  const hosts: string[] = [];
  let connected = false;
  const connector: EmailSmtpConnector = {
    async connect(host) {
      connected = true;
      hosts.push(host);
      return {
        async readLine() {
          const next = responses.shift();
          if (!next) throw new Error("No scripted SMTP response available");
          return next;
        },
        async writeLine(line) {
          writes.push(line);
        },
        async close() {},
      };
    },
  };
  return { connector, hosts, writes, wasConnected: () => connected };
}

describe("SMTP probing", () => {
  test("probeSmtp performs HELO, MAIL FROM, and RCPT TO", async () => {
    const smtp = scriptedConnector([
      "220 mx.example.com ESMTP",
      "250-mx.example.com",
      "250 SIZE 1000000",
      "250 OK",
      "250 Accepted",
    ]);

    const check = await probeSmtp("user@example.com", {
      dns: { resolver: mxResolver() },
      smtp: {
        connector: smtp.connector,
        tls: "disable",
        sender: "probe@example.com",
        detectCatchAll: false,
      },
      policy: { allowSpecialUseDomains: true },
    });

    expect(check.status).toBe("pass");
    expect(check.valid).toBe(true);
    expect(smtp.hosts).toEqual(["93.184.216.34"]);
    expect(smtp.writes).toEqual([
      "EHLO example.com",
      "MAIL FROM:<probe@example.com>",
      "RCPT TO:<user@example.com>",
    ]);
  });

  test("SMTP recipient rejection can block validation by policy", async () => {
    const smtp = scriptedConnector([
      "220 mx.example.com ESMTP",
      "250 mx.example.com",
      "250 OK",
      "550 No such user",
    ]);

    const result = await validateEmail("missing@example.com", {
      checks: { smtp: true },
      dns: { resolver: mxResolver() },
      smtp: { connector: smtp.connector, tls: "disable" },
      policy: { allowSpecialUseDomains: true, blockOnSmtpRejection: true },
    });

    expect(result.valid).toBe(false);
    expect(result.checks.smtp.status).toBe("fail");
    expect(result.checks.smtp.valid).toBe(false);
    expect(result.checks.smtp.reasons).toEqual(["mailbox_rejected"]);
    expect(result.issues[0]?.code).toBe("email.smtp.rejected");
  });

  test("SMTP recipient rejection is surfaced in summary even when diagnostic", async () => {
    const smtp = scriptedConnector([
      "220 mx.example.com ESMTP",
      "250 mx.example.com",
      "250 OK",
      "550 No such user",
    ]);

    const result = await validateEmail("missing@example.com", {
      checks: { smtp: true },
      dns: { resolver: mxResolver() },
      smtp: { connector: smtp.connector, tls: "disable" },
      policy: { allowSpecialUseDomains: true },
    });

    expect(result.valid).toBe(true);
    expect(result.decision.accepted).toBe(true);
    expect(result.status).toBe("undeliverable");
    expect(result.reason).toBe("mailbox_rejected");
    expect(result.recommendation).toBe("reject");
    expect(result.checks.smtp.status).toBe("fail");
    expect(result.checks.smtp.valid).toBe(false);
    expect(result.issues).toEqual([]);
  });

  test("blockOnSmtpRejection policy implicitly enables SMTP", async () => {
    const smtp = scriptedConnector([
      "220 mx.example.com ESMTP",
      "250 mx.example.com",
      "250 OK",
      "550 No such user",
    ]);

    const result = await validateEmail("missing@example.com", {
      dns: { resolver: mxResolver() },
      smtp: { connector: smtp.connector, tls: "disable" },
      policy: { allowSpecialUseDomains: true, blockOnSmtpRejection: true },
    });

    expect(result.valid).toBe(false);
    expect(result.checks.smtp.status).toBe("fail");
    expect(result.issues[0]?.code).toBe("email.smtp.rejected");
  });

  test("explicit SMTP disable wins over blockOnSmtpRejection policy", async () => {
    const smtp = scriptedConnector(["220 mx.example.com ESMTP"]);

    const result = await validateEmail("missing@example.com", {
      checks: { smtp: false },
      dns: { resolver: mxResolver() },
      smtp: { connector: smtp.connector, tls: "disable" },
      policy: { allowSpecialUseDomains: true, blockOnSmtpRejection: true },
    });

    expect(result.valid).toBe(false);
    expect(result.checks.smtp.status).toBe("not_checked");
    expect(result.issues[0]?.code).toBe("email.smtp.not_checked");
    expect(smtp.wasConnected()).toBe(false);
  });

  test("falls back from EHLO to HELO when needed", async () => {
    const smtp = scriptedConnector([
      "220 mx.example.com ESMTP",
      "500 EHLO unsupported",
      "250 mx.example.com",
      "250 OK",
      "250 Accepted",
    ]);

    const check = await probeSmtp("user@example.com", {
      dns: { resolver: mxResolver() },
      smtp: {
        connector: smtp.connector,
        tls: "disable",
        heloName: "client.example",
        detectCatchAll: false,
      },
      policy: { allowSpecialUseDomains: true },
    });

    expect(check.status).toBe("pass");
    expect(smtp.writes[0]).toBe("EHLO client.example");
    expect(smtp.writes[1]).toBe("HELO client.example");
  });

  test("catch-all detection runs by default and returns inconclusive", async () => {
    const smtp = scriptedConnector([
      "220 mx.example.com ESMTP",
      "250 mx.example.com",
      "250 OK",
      "250 Accepted",
      "250 Accepted",
    ]);

    const check = await probeSmtp("user@example.com", {
      dns: { resolver: mxResolver() },
      smtp: {
        connector: smtp.connector,
        tls: "disable",
        catchAllAddressFactory: () => "unlikely-catchall@example.com",
      },
      policy: { allowSpecialUseDomains: true },
    });

    expect(check.status).toBe("warning");
    expect(check.valid).toBeNull();
    expect(check.reasons).toEqual(["catch_all"]);
    expect(smtp.writes.at(-1)).toBe("RCPT TO:<unlikely-catchall@example.com>");
  });

  test("SMTP accepted with catch-all rejected becomes deliverable summary", async () => {
    const smtp = scriptedConnector([
      "220 mx.example.com ESMTP",
      "250 mx.example.com",
      "250 OK",
      "250 Accepted",
      "550 No such user",
    ]);

    const result = await validateEmail("user@example.com", {
      checks: { smtp: true },
      dns: { resolver: mxResolver() },
      smtp: {
        connector: smtp.connector,
        tls: "disable",
        catchAllAddressFactory: () => "unlikely-catchall@example.com",
      },
      policy: { allowSpecialUseDomains: true },
    });

    expect(result.valid).toBe(true);
    expect(result.status).toBe("deliverable");
    expect(result.reason).toBe("accepted");
    expect(result.recommendation).toBe("accept");
    expect(result.checks.smtp.status).toBe("pass");
    expect(result.checks.smtp.valid).toBe(true);
  });

  test("SMTP catch-all becomes risky verify summary", async () => {
    const smtp = scriptedConnector([
      "220 mx.example.com ESMTP",
      "250 mx.example.com",
      "250 OK",
      "250 Accepted",
      "250 Accepted",
    ]);

    const result = await validateEmail("user@example.com", {
      checks: { smtp: true },
      dns: { resolver: mxResolver() },
      smtp: {
        connector: smtp.connector,
        tls: "disable",
        catchAllAddressFactory: () => "unlikely-catchall@example.com",
      },
      policy: { allowSpecialUseDomains: true },
    });

    expect(result.valid).toBe(true);
    expect(result.status).toBe("risky");
    expect(result.reason).toBe("catch_all");
    expect(result.recommendation).toBe("verify");
    expect(result.checks.smtp.status).toBe("warning");
    expect(result.checks.smtp.valid).toBeNull();
  });

  test("invalid SMTP catch-all probe options do not look deliverable", async () => {
    const smtp = scriptedConnector([
      "220 mx.example.com ESMTP",
      "250 mx.example.com",
      "250 OK",
      "250 Accepted",
    ]);

    const result = await validateEmail("user@example.com", {
      checks: { smtp: true },
      dns: { resolver: mxResolver() },
      smtp: {
        connector: smtp.connector,
        tls: "disable",
        catchAllAddressFactory: () => "bad\r\nRCPT TO:<attacker@example.com>",
      },
      policy: { allowSpecialUseDomains: true },
    });

    expect(result.valid).toBe(true);
    expect(result.status).toBe("unknown");
    expect(result.reason).toBe("smtp_error");
    expect(result.recommendation).toBe("verify");
    expect(result.checks.smtp.status).toBe("fail");
    expect(result.checks.smtp.reasons).toEqual(["invalid_option"]);
  });

  test("explicit SMTP check reports dependency state instead of staying not_checked", async () => {
    const result = await validateEmail("user@example.com", {
      checks: { dns: false, smtp: true },
      policy: { allowSpecialUseDomains: true },
    });

    expect(result.valid).toBe(true);
    expect(result.checks.smtp.status).toBe("unknown");
    expect(result.checks.smtp.valid).toBeNull();
    expect(result.checks.smtp.reasons).toEqual(["dns_not_checked"]);
  });

  test("SMTP options reject CRLF injection before connecting", async () => {
    const smtp = scriptedConnector(["220 mx.example.com ESMTP"]);
    const check = await probeSmtp("user@example.com", {
      dns: { resolver: mxResolver() },
      smtp: {
        connector: smtp.connector,
        tls: "disable",
        sender: "probe@example.com\r\nRCPT TO:<attacker@example.com>",
      },
      policy: { allowSpecialUseDomains: true },
    });

    expect(check.status).toBe("fail");
    expect(check.reasons).toEqual(["invalid_option"]);
    expect(smtp.wasConnected()).toBe(false);
  });

  test("SMTP blocks private MX targets unless explicitly allowed", async () => {
    const smtp = scriptedConnector(["220 mx.example.com ESMTP"]);
    const resolver = mxResolver("mx.internal.example");
    resolver.lookup = async () => [{ address: "127.0.0.1", family: 4 }];

    const check = await probeSmtp("user@example.com", {
      dns: { resolver },
      smtp: { connector: smtp.connector, tls: "disable" },
      policy: { allowSpecialUseDomains: true },
    });

    expect(check.status).toBe("fail");
    expect(check.valid).toBeNull();
    expect(check.reasons).toEqual(["network_blocked"]);
    expect(smtp.wasConnected()).toBe(false);
  });

  test("SMTP blocks documentation and reserved target ranges", async () => {
    const smtp = scriptedConnector(["220 mx.example.com ESMTP"]);
    const resolver = mxResolver("mx.reserved.example");
    resolver.lookup = async () => [{ address: "203.0.113.10", family: 4 }];

    const check = await probeSmtp("user@example.com", {
      dns: { resolver },
      smtp: { connector: smtp.connector, tls: "disable" },
      policy: { allowSpecialUseDomains: true },
    });

    expect(check.status).toBe("fail");
    expect(check.reasons).toEqual(["network_blocked"]);
    expect(smtp.wasConnected()).toBe(false);
  });

  test("SMTP blocks compressed Teredo IPv6 target ranges", async () => {
    const smtp = scriptedConnector(["220 mx.example.com ESMTP"]);
    const resolver = mxResolver("mx.teredo.example");
    resolver.lookup = async () => [{ address: "2001::1", family: 6 }];

    const check = await probeSmtp("user@example.com", {
      dns: { resolver },
      smtp: { connector: smtp.connector, tls: "disable" },
      policy: { allowSpecialUseDomains: true },
    });

    expect(check.status).toBe("fail");
    expect(check.reasons).toEqual(["network_blocked"]);
    expect(smtp.wasConnected()).toBe(false);
  });

  test("SMTP blocks expanded IPv6 loopback spellings", async () => {
    const smtp = scriptedConnector(["220 mx.example.com ESMTP"]);
    const resolver = mxResolver("mx.loopback.example");
    resolver.lookup = async () => [{ address: "0:0:0:0:0:0:0:1", family: 6 }];

    const check = await probeSmtp("user@example.com", {
      dns: { resolver },
      smtp: { connector: smtp.connector, tls: "disable" },
      policy: { allowSpecialUseDomains: true },
    });

    expect(check.status).toBe("fail");
    expect(check.reasons).toEqual(["network_blocked"]);
    expect(smtp.wasConnected()).toBe(false);
  });
});
