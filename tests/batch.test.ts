import { describe, expect, test } from "bun:test";
import { validateEmails } from "../src/index.js";
import type { EmailDnsResolver, EmailSmtpConnector } from "../src/types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("batch validation", () => {
  test("returns ordered results and aggregate issue counts", async () => {
    const batch = await validateEmails(["a@example.com", "bad@@example.com"], {
      checks: { dns: false },
      policy: { allowSpecialUseDomains: true },
      batch: { concurrency: 2 },
    });

    expect(batch.results.map((result) => result.input)).toEqual([
      "a@example.com",
      "bad@@example.com",
    ]);
    expect(batch.summary.total).toBe(2);
    expect(batch.summary.accepted).toBe(1);
    expect(batch.summary.rejected).toBe(1);
    expect(batch.summary.byCode["email.syntax.too_many_at"]).toBe(1);
    expect(batch.summary.byStage.syntax).toBe(1);
  });

  test("shares validation cache across batch items", async () => {
    let mxCalls = 0;
    const resolver: EmailDnsResolver = {
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
    };

    const batch = await validateEmails(["a@example.com", "b@example.com"], {
      dns: { resolver },
      policy: { allowSpecialUseDomains: true },
      batch: { concurrency: 1 },
    });

    expect(batch.results.every((result) => result.valid)).toBe(true);
    expect(mxCalls).toBe(1);
  });

  test("honors DNS concurrency separately from overall batch concurrency", async () => {
    let activeMx = 0;
    let maxActiveMx = 0;
    const resolver: EmailDnsResolver = {
      async resolveMx(domain) {
        activeMx += 1;
        maxActiveMx = Math.max(maxActiveMx, activeMx);
        await sleep(5);
        activeMx -= 1;
        return [{ exchange: `mx.${domain}`, priority: 1 }];
      },
      async resolve4() {
        return [];
      },
      async resolve6() {
        return [];
      },
    };

    await validateEmails(
      ["a@one.com", "a@two.com", "a@three.com", "a@four.com"],
      {
        dns: { resolver },
        policy: { allowSpecialUseDomains: true },
        batch: { concurrency: 4, dnsConcurrency: 1 },
      },
    );

    expect(maxActiveMx).toBe(1);
  });

  test("honors SMTP concurrency separately from overall batch concurrency", async () => {
    let activeConnects = 0;
    let maxActiveConnects = 0;
    const resolver: EmailDnsResolver = {
      async resolveMx(domain) {
        return [{ exchange: `mx.${domain}`, priority: 1 }];
      },
      async resolve4() {
        return [];
      },
      async resolve6() {
        return [];
      },
      async lookup() {
        return [{ address: "93.184.216.34", family: 4 }];
      },
    };
    const connector: EmailSmtpConnector = {
      async connect() {
        activeConnects += 1;
        maxActiveConnects = Math.max(maxActiveConnects, activeConnects);
        await sleep(5);
        return {
          async readLine() {
            return activeConnects > 0 ? "220 mx.example.com" : "250 OK";
          },
          async writeLine() {},
          async close() {
            activeConnects -= 1;
          },
        };
      },
    };

    await validateEmails(
      ["a@one.com", "a@two.com", "a@three.com", "a@four.com"],
      {
        checks: { smtp: true },
        dns: { resolver },
        smtp: { connector, tls: "disable" },
        policy: { allowSpecialUseDomains: true },
        batch: { concurrency: 4, smtpConcurrency: 1 },
      },
    );

    expect(maxActiveConnects).toBe(1);
  });

  test("STARTTLS keeps SMTP concurrency permit until upgraded connection closes", async () => {
    let activeSessions = 0;
    let maxActiveSessions = 0;
    const resolver: EmailDnsResolver = {
      async resolveMx(domain) {
        return [{ exchange: `mx.${domain}`, priority: 1 }];
      },
      async resolve4() {
        return [];
      },
      async resolve6() {
        return [];
      },
      async lookup() {
        return [{ address: "93.184.216.34", family: 4 }];
      },
    };
    const connector: EmailSmtpConnector = {
      async connect() {
        activeSessions += 1;
        maxActiveSessions = Math.max(maxActiveSessions, activeSessions);
        let phase = 0;
        return {
          async readLine() {
            const responses = [
              "220 mx.example.com",
              "250-mx.example.com",
              "250 STARTTLS",
              "220 Ready",
            ];
            return responses[phase++] ?? "250 OK";
          },
          async writeLine() {},
          async startTls() {
            let upgradedPhase = 0;
            return {
              async readLine() {
                const responses = ["250 mx.example.com", "250 OK", "250 Accepted"];
                return responses[upgradedPhase++] ?? "250 OK";
              },
              async writeLine() {},
              async close() {
                activeSessions -= 1;
              },
            };
          },
          async close() {},
        };
      },
    };

    await validateEmails(["a@one.com", "a@two.com"], {
      checks: { smtp: true },
      dns: { resolver },
      smtp: { connector },
      policy: { allowSpecialUseDomains: true },
      batch: { concurrency: 2, smtpConcurrency: 1 },
    });

    expect(maxActiveSessions).toBe(1);
  });
});
