// Minimal RESP (REdis Serialization Protocol) primitives over node:net.
//
// Extracted from realtime/pubsub.ts so BOTH shared-state adapters can use one
// implementation: the pub/sub bus (§15.2) and the rate-limit store (§15.3).
// Aidit deliberately ships NO redis client dependency — the surface it needs is
// a dozen commands, and a hand-rolled RESP codec keeps the dependency footprint
// (and its supply-chain surface) at zero.
//
// Scope: RESP2 replies that Redis returns for the commands used here — simple
// strings (+), errors (-), integers (:), bulk strings ($) and arrays (*).

import net from "node:net";

export interface RedisTarget {
  host: string;
  port: number;
  password?: string;
}

/** Parse redis://[:password@]host:port (also accepts rediss:// hosts). */
export function parseRedisUrl(url: string): RedisTarget | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "redis:" && u.protocol !== "rediss:") return null;
    const host = u.hostname || "127.0.0.1";
    const port = u.port === "" ? 6379 : Number(u.port);
    if (!Number.isInteger(port) || port <= 0) return null;
    const password = u.password !== "" ? decodeURIComponent(u.password) : undefined;
    return { host, port, ...(password !== undefined ? { password } : {}) };
  } catch {
    return null;
  }
}

/** Encode a RESP array command: *N\r\n$len\r\narg\r\n... */
export function encodeCommand(args: string[]): string {
  let out = `*${args.length}\r\n`;
  for (const arg of args) {
    out += `$${Buffer.byteLength(arg, "utf8")}\r\n${arg}\r\n`;
  }
  return out;
}

/**
 * Incremental RESP reader. Feed bytes, pull complete replies.
 *
 * Nested arrays are supported, which is what pub/sub pushes and
 * `ZRANGE … WITHSCORES` replies are.
 */
export class RespParser {
  private buf: Buffer = Buffer.alloc(0);

  feed(chunk: Buffer): void {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
  }

  /** Pull the next complete reply, or undefined if more bytes are needed. */
  next(): unknown | undefined {
    const parsed = this.parseAt(0);
    if (!parsed) return undefined;
    this.buf = this.buf.subarray(parsed.end);
    return parsed.value;
  }

  private parseAt(offset: number): { value: unknown; end: number } | undefined {
    if (offset >= this.buf.length) return undefined;
    const type = String.fromCharCode(this.buf[offset]!);
    const lineEnd = this.buf.indexOf("\r\n", offset);
    if (lineEnd === -1) return undefined;
    const line = this.buf.toString("utf8", offset + 1, lineEnd);
    const afterLine = lineEnd + 2;

    switch (type) {
      case "+":
        return { value: line, end: afterLine };
      case "-":
        return { value: new Error(line), end: afterLine };
      case ":":
        return { value: Number(line), end: afterLine };
      case "$": {
        const len = Number(line);
        if (len === -1) return { value: null, end: afterLine };
        const end = afterLine + len + 2;
        if (this.buf.length < end) return undefined;
        return {
          value: this.buf.toString("utf8", afterLine, afterLine + len),
          end,
        };
      }
      case "*": {
        const count = Number(line);
        if (count === -1) return { value: null, end: afterLine };
        const items: unknown[] = [];
        let cursor = afterLine;
        for (let i = 0; i < count; i += 1) {
          const item = this.parseAt(cursor);
          if (!item) return undefined;
          items.push(item.value);
          cursor = item.end;
        }
        return { value: items, end: cursor };
      }
      default:
        // Unknown type byte — skip the line rather than wedging the stream.
        return { value: null, end: afterLine };
    }
  }
}

const RECONNECT_BASE_MS = 200;
const RECONNECT_MAX_MS = 5_000;

/**
 * One managed Redis socket: backoff reconnect + a pending write queue so a
 * command issued before the socket is ready is flushed on connect rather than
 * dropped.
 */
export class RedisConnection {
  private socket: net.Socket | null = null;
  private ready = false;
  private closed = false;
  private attempt = 0;
  private pending: string[] = [];
  private readonly parser = new RespParser();

  constructor(
    private readonly target: RedisTarget,
    private readonly onReply: (reply: unknown) => void,
    private readonly onReady: () => void,
    private readonly onError: (err: Error) => void,
  ) {
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    const socket = net.createConnection({
      host: this.target.host,
      port: this.target.port,
    });
    socket.setNoDelay(true);
    this.socket = socket;

    socket.on("connect", () => {
      this.ready = true;
      this.attempt = 0;
      if (this.target.password !== undefined) {
        socket.write(encodeCommand(["AUTH", this.target.password]));
      }
      const queued = this.pending;
      this.pending = [];
      for (const cmd of queued) socket.write(cmd);
      this.onReady();
    });

    socket.on("data", (chunk: Buffer) => {
      this.parser.feed(chunk);
      for (;;) {
        const reply = this.parser.next();
        if (reply === undefined) break;
        this.onReply(reply);
      }
    });

    socket.on("error", (err: Error) => {
      this.onError(err);
    });

    socket.on("close", () => {
      this.ready = false;
      this.socket = null;
      if (this.closed) return;
      this.attempt += 1;
      const delay = Math.min(
        RECONNECT_MAX_MS,
        RECONNECT_BASE_MS * 2 ** (this.attempt - 1),
      );
      const timer = setTimeout(() => this.connect(), delay);
      if (typeof timer.unref === "function") timer.unref();
    });
  }

  /** True once the socket is connected (writes go out immediately). */
  get isReady(): boolean {
    return this.ready;
  }

  send(command: string): void {
    if (this.closed) return;
    if (this.ready && this.socket) {
      this.socket.write(command);
      return;
    }
    this.pending.push(command);
  }

  close(): void {
    this.closed = true;
    this.pending = [];
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
}
