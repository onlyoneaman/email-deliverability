import { Socket, connect as netConnect, isIP } from "node:net";
import { TLSSocket, connect as tlsConnect } from "node:tls";
import { defaultDnsResolver } from "./dns.js";
import { issue } from "./result.js";
import type {
  DnsDeliverabilityCheck,
  EmailIssue,
  ParsedEmail,
  SmtpConnection,
  SmtpProbeCheck,
  ValidateEmailOptions,
} from "./types.js";

const DEFAULT_SMTP_TIMEOUT_MS = 5_000;

export async function checkSmtpProbe(args: {
  parsed: ParsedEmail;
  dns: DnsDeliverabilityCheck;
  options: ValidateEmailOptions;
}): Promise<{ check: SmtpProbeCheck; issues: EmailIssue[] }> {
  const startedAt = performance.now();
  const timeoutMs = args.options.smtp?.timeoutMs ?? DEFAULT_SMTP_TIMEOUT_MS;
  const target = smtpTarget(args.parsed, args.dns);
  if (!target) {
    return {
      check: {
        status: "unknown",
        reasons: [args.dns.status === "not_checked" ? "dns_not_checked" : "no_smtp_target"],
        valid: null,
        durationMs: elapsed(startedAt),
      },
      issues: [],
    };
  }
  const connectionTarget = await resolveConnectionTarget(target.host, args.options);
  if (!connectionTarget) return fail(startedAt, "network_blocked", null);

  const rcptTo = args.parsed.asciiEmail;
  if (!rcptTo) {
    return unknown(startedAt, "smtputf8_not_supported");
  }

  const sender = args.options.smtp?.sender ?? "";
  const heloName = deriveHeloName(args.options.smtp?.heloName, sender);
  if (hasLineBreak(heloName) || hasLineBreak(sender) || hasLineBreak(rcptTo)) {
    return fail(startedAt, "invalid_option");
  }

  const connector = args.options.smtp?.connector ?? defaultSmtpConnector;
  const port = args.options.smtp?.port ?? 25;
  const tlsMode = args.options.smtp?.tls ?? "opportunistic";
  let connection: SmtpConnection | undefined;
  try {
    connection = await connector.connect(connectionTarget.address, port, {
      tls: false,
      serverName: target.host,
      timeoutMs,
      ...(args.options.signal ? { signal: args.options.signal } : {}),
    });
    if (connection.remoteAddress && isBlockedAddress(connection.remoteAddress)) {
      return fail(startedAt, "network_blocked", null);
    }
    let greeting = await readResponse(connection, args.options, timeoutMs);
    if (greeting.code !== 220) return unknown(startedAt, "bad_greeting");

    let ehlo = await command(connection, `EHLO ${heloName}`, args.options, timeoutMs);
    const ehloAvailable = ehlo.code === 250;
    if (!ehloAvailable) {
      const helo = await command(connection, `HELO ${heloName}`, args.options, timeoutMs);
      if (helo.code !== 250) return unknown(startedAt, "helo_rejected");
    }

    if (
      tlsMode !== "disable" &&
      ehloAvailable &&
      ehlo.lines.some((line) => /\bSTARTTLS\b/i.test(line))
    ) {
      const startTls = await command(connection, "STARTTLS", args.options, timeoutMs);
      if (startTls.code !== 220) {
        if (tlsMode === "require") return unknown(startedAt, "starttls_rejected");
      } else if (connection.startTls) {
        connection = await connection.startTls(target.host, {
          timeoutMs,
          ...(args.options.signal ? { signal: args.options.signal } : {}),
        });
        if (connection.remoteAddress && isBlockedAddress(connection.remoteAddress)) {
          return fail(startedAt, "network_blocked", null);
        }
        ehlo = await command(connection, `EHLO ${heloName}`, args.options, timeoutMs);
        if (ehlo.code !== 250) return unknown(startedAt, "ehlo_rejected");
      } else {
        return unknown(startedAt, "starttls_unavailable");
      }
    } else if (tlsMode === "require") {
      return unknown(startedAt, "starttls_unavailable");
    }

    const mail = await command(
      connection,
      `MAIL FROM:${mailPath(sender)}`,
      args.options,
      timeoutMs,
    );
    if (mail.code !== 250) return unknown(startedAt, "mail_from_rejected");

    const rcpt = await command(connection, `RCPT TO:<${rcptTo}>`, args.options, timeoutMs);
    if (rcpt.code === 250 || rcpt.code === 251) {
      if (args.options.smtp?.detectCatchAll) {
        const catchAll = await checkCatchAll(connection, args, timeoutMs);
        if (catchAll) return catchAll;
      }
      return {
        check: {
          status: "pass",
          reasons: smtpReasons("accepted", sender, heloName),
          valid: true,
          durationMs: elapsed(startedAt),
        },
        issues: [],
      };
    }
    if ([550, 551, 553].includes(rcpt.code)) {
      return {
        check: {
          status: "fail",
          reasons: ["mailbox_rejected"],
          valid: false,
          durationMs: elapsed(startedAt),
        },
        issues: [],
      };
    }
    if ([421, 450, 451, 452].includes(rcpt.code)) {
      return unknown(startedAt, "temporary_failure", "warning");
    }
    return unknown(startedAt, "unexpected_response");
  } catch (error) {
    if (isAbortOrTimeout(error)) {
      return {
        check: {
          status: "timeout",
          reasons: ["smtp_timeout"],
          valid: null,
          durationMs: elapsed(startedAt),
        },
        issues: [],
      };
    }
    return {
      check: {
        status: "error",
        reasons: ["smtp_error"],
        valid: null,
        durationMs: elapsed(startedAt),
      },
      issues: [issue("email.smtp.error", "smtp", false, { path: ["checks", "smtp"] })],
    };
  } finally {
    await connection?.close();
  }
}

async function checkCatchAll(
  connection: SmtpConnection,
  args: { parsed: ParsedEmail; options: ValidateEmailOptions },
  timeoutMs: number,
): Promise<{ check: SmtpProbeCheck; issues: EmailIssue[] } | null> {
  const probe = catchAllProbeAddress(args.parsed, args.options);
  if (hasLineBreak(probe)) return fail(performance.now(), "invalid_option", null);
  const rcpt = await command(connection, `RCPT TO:<${probe}>`, args.options, timeoutMs);
  if (rcpt.code === 250 || rcpt.code === 251) {
    return {
      check: {
        status: "warning",
        reasons: ["catch_all"],
        valid: null,
      },
      issues: [],
    };
  }
  if ([421, 450, 451, 452].includes(rcpt.code)) {
    return {
      check: {
        status: "warning",
        reasons: ["temporary_failure"],
        valid: null,
      },
      issues: [],
    };
  }
  return null;
}

function catchAllProbeAddress(parsed: ParsedEmail, options: ValidateEmailOptions): string {
  const custom = options.smtp?.catchAllAddressFactory?.();
  if (custom) return custom;
  const random = Math.random().toString(36).slice(2, 12);
  return `__email_deliverability_${Date.now()}_${random}@${parsed.asciiDomain}`;
}

export const defaultSmtpConnector = {
  async connect(
    host: string,
    port: number,
    options: {
      tls?: boolean;
      serverName?: string;
      timeoutMs?: number;
      signal?: AbortSignal;
    } = {},
  ) {
    const socket = options.tls
      ? tlsConnect({ host, port, servername: options.serverName ?? host })
      : netConnect(port, host);
    return socketConnection(socket, options);
  },
};

function socketConnection(socket: Socket | TLSSocket, options: { timeoutMs?: number; signal?: AbortSignal }) {
  socket.setEncoding("utf8");
  const buffer = { value: "" };
  return new Promise<SmtpConnection>((resolve, reject) => {
    let abortCleanup = () => {};
    const cleanup = () => {
      abortCleanup();
      socket.off("connect", onConnect);
      socket.off("secureConnect", onConnect);
      socket.off("error", onError);
    };
    const onConnect = () => {
      cleanup();
      resolve({
        get remoteAddress() {
          return socket.remoteAddress;
        },
        readLine(readOptions) {
          return readSocketLine(socket, buffer, readOptions);
        },
        writeLine(line, writeOptions) {
          return writeSocketLine(socket, `${line}\r\n`, writeOptions);
        },
        startTls(serverName, tlsOptions) {
          const tlsSocket = tlsConnect({ socket, servername: serverName });
          return socketConnection(tlsSocket, tlsOptions ?? {});
        },
        close() {
          socket.destroy();
        },
      });
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    socket.once("connect", onConnect);
    socket.once("secureConnect", onConnect);
    socket.once("error", onError);
    abortCleanup = withAbort(options, () => {
      cleanup();
      socket.destroy();
      reject(new DOMException("SMTP timeout", "TimeoutError"));
    });
  });
}

async function command(
  connection: SmtpConnection,
  line: string,
  options: ValidateEmailOptions,
  timeoutMs: number,
) {
  await connection.writeLine(line, {
    timeoutMs,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return readResponse(connection, options, timeoutMs);
}

async function readResponse(
  connection: SmtpConnection,
  options: ValidateEmailOptions,
  timeoutMs: number,
): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  let expectedCode: number | undefined;
  for (;;) {
    const line = await connection.readLine({
      timeoutMs,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    lines.push(line);
    const code = Number(line.slice(0, 3));
    if (!Number.isInteger(code) || (line[3] !== " " && line[3] !== "-")) {
      return { code: 0, lines };
    }
    expectedCode ??= code;
    if (line[3] !== "-" || code !== expectedCode) return { code, lines };
  }
}

async function readSocketLine(
  socket: Socket | TLSSocket,
  buffer: { value: string },
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const tryRead = () => {
      const index = buffer.value.indexOf("\n");
      if (index === -1) return false;
      const line = buffer.value.slice(0, index).replace(/\r$/, "");
      buffer.value = buffer.value.slice(index + 1);
      cleanup();
      resolve(line);
      return true;
    };
    const onData = (chunk: string) => {
      buffer.value += chunk;
      tryRead();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const abortCleanup = withAbort(options, () => {
      cleanup();
      reject(new DOMException("SMTP timeout", "TimeoutError"));
    });
    const cleanup = () => {
      abortCleanup();
      socket.off("data", onData);
      socket.off("error", onError);
    };
    if (tryRead()) return;
    socket.on("data", onData);
    socket.once("error", onError);
  });
}

async function writeSocketLine(
  socket: Socket | TLSSocket,
  line: string,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = withAbort(options, () => {
      reject(new DOMException("SMTP timeout", "TimeoutError"));
    });
    socket.write(line, (error) => {
      cleanup();
      if (error) reject(error);
      else resolve();
    });
  });
}

function withAbort(
  options: { timeoutMs?: number; signal?: AbortSignal } | undefined,
  abort: () => void,
): () => void {
  const timeout = options?.timeoutMs ? setTimeout(abort, options.timeoutMs) : undefined;
  if (options?.signal?.aborted) abort();
  options?.signal?.addEventListener("abort", abort, { once: true });
  return () => {
    if (timeout) clearTimeout(timeout);
    options?.signal?.removeEventListener("abort", abort);
  };
}

function smtpTarget(parsed: ParsedEmail, dns: DnsDeliverabilityCheck): { host: string } | null {
  if (dns.status === "not_checked") return null;
  const mx = dns.mxRecords?.[0]?.exchange;
  if (mx) return { host: mx };
  if (dns.status === "pass") return { host: parsed.asciiDomain };
  return null;
}

async function resolveConnectionTarget(
  host: string,
  options: ValidateEmailOptions,
): Promise<{ address: string } | null> {
  if (options.smtp?.allowPrivateNetworks) return { address: host };
  const resolveOptions = {
    ...(options.dns?.timeoutMs !== undefined ? { timeoutMs: options.dns.timeoutMs } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  };
  const resolver = options.dns?.resolver ?? defaultDnsResolver;
  const lookupAddresses = await resolver.lookup?.(host, resolveOptions);
  const addresses =
    lookupAddresses ??
    [
      ...(await resolver.resolve4(host, resolveOptions)).map((address) => ({
        address,
        family: 4 as const,
      })),
      ...(await resolver.resolve6(host, resolveOptions)).map((address) => ({
        address,
        family: 6 as const,
      })),
    ];
  const publicAddress = addresses.find((entry) => !isBlockedAddress(entry.address));
  return publicAddress ? { address: publicAddress.address } : null;
}

function isBlockedAddress(address: string): boolean {
  const value = address.toLowerCase();
  const hextets = parseIpv6(value);
  if (hextets) {
    const mapped = ipv4FromMappedIpv6(hextets);
    if (mapped) return isBlockedAddress(mapped);
    return isBlockedIpv6(hextets);
  }
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return false;
  const [a, b, c] = octets as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function parseIpv6(address: string): number[] | null {
  if (isIP(address) !== 6) return null;
  const [headRaw, tailRaw] = address.split("::") as [string, string | undefined];
  const head = parseIpv6Side(headRaw);
  const tail = tailRaw === undefined ? [] : parseIpv6Side(tailRaw);
  if (!head || !tail) return null;
  const missing = 8 - head.length - tail.length;
  if (tailRaw === undefined && missing !== 0) return null;
  if (tailRaw !== undefined && missing < 0) return null;
  return [...head, ...Array.from({ length: missing }, () => 0), ...tail];
}

function parseIpv6Side(side: string): number[] | null {
  if (!side) return [];
  const pieces = side.split(":");
  const result: number[] = [];
  for (const piece of pieces) {
    if (piece.includes(".")) {
      const octets = piece.split(".").map(Number);
      if (octets.length !== 4 || octets.some((part) => part < 0 || part > 255)) return null;
      result.push((octets[0]! << 8) + octets[1]!, (octets[2]! << 8) + octets[3]!);
      continue;
    }
    const value = Number.parseInt(piece, 16);
    if (!piece || !Number.isInteger(value) || value < 0 || value > 0xffff) return null;
    result.push(value);
  }
  return result;
}

function ipv4FromMappedIpv6(hextets: number[]): string | null {
  if (
    hextets.slice(0, 5).every((part) => part === 0) &&
    hextets[5] === 0xffff
  ) {
    const high = hextets[6]!;
    const low = hextets[7]!;
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  }
  return null;
}

function isBlockedIpv6(hextets: number[]): boolean {
  const [first, second] = hextets as [number, number, ...number[]];
  const allZero = hextets.every((part) => part === 0);
  const loopback = hextets.slice(0, 7).every((part) => part === 0) && hextets[7] === 1;
  return (
    allZero ||
    loopback ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    first === 0x2002 ||
    (first === 0x2001 && second === 0x0000) ||
    (first === 0x2001 && second === 0x0db8) ||
    (first === 0x0064 && second === 0xff9b)
  );
}

function deriveHeloName(heloName: string | undefined, sender: string): string {
  if (heloName) return heloName;
  const at = sender.lastIndexOf("@");
  if (at !== -1 && sender.slice(at + 1)) return sender.slice(at + 1);
  return "localhost";
}

function smtpReasons(primary: string, sender: string, heloName: string): string[] {
  const reasons = [primary];
  if (!sender) reasons.push("null_sender");
  if (heloName === "localhost") reasons.push("localhost_helo");
  return reasons;
}

function mailPath(sender: string): string {
  return sender ? `<${sender}>` : "<>";
}

function hasLineBreak(value: string): boolean {
  return /[\r\n]/.test(value);
}

function fail(
  startedAt: number,
  reason: string,
  valid: false | null = false,
): { check: SmtpProbeCheck; issues: EmailIssue[] } {
  return {
    check: { status: "fail", reasons: [reason], valid, durationMs: elapsed(startedAt) },
    issues: [],
  };
}

function unknown(
  startedAt: number,
  reason: string,
  status: "unknown" | "warning" = "unknown",
): { check: SmtpProbeCheck; issues: EmailIssue[] } {
  return {
    check: { status, reasons: [reason], valid: null, durationMs: elapsed(startedAt) },
    issues: [],
  };
}

function isAbortOrTimeout(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError");
}

function elapsed(startedAt: number): number {
  return Math.max(0, Math.round((performance.now() - startedAt) * 1000) / 1000);
}
