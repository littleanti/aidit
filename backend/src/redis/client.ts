// Promise-based Redis command client on top of the RESP primitives.
//
// The pub/sub bus only ever WRITES (PUBLISH/SUBSCRIBE) and reacts to pushes, so
// it needs no reply correlation. The rate-limit store (§15.3) does: it must read
// ZCARD/ZRANGE answers back. RESP2 has no request ids — replies arrive strictly
// in the order the commands were sent — so correlation is a FIFO queue of
// resolvers, which is also what makes pipelining safe.

import {
  RedisConnection,
  encodeCommand,
  type RedisTarget,
} from "./resp.js";

/** A command timing out must not leak its resolver forever. */
const COMMAND_TIMEOUT_MS = 2_000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  /** Already rejected by a timeout — its reply, if it arrives, must be discarded. */
  dead: boolean;
}

export class RedisCommandClient {
  private readonly connection: RedisConnection;
  private readonly pending: Pending[] = [];
  private closed = false;

  constructor(
    target: RedisTarget,
    private readonly log: (msg: string) => void = () => {},
  ) {
    this.connection = new RedisConnection(
      target,
      (reply) => this.handleReply(reply),
      () => {},
      (err) => {
        this.log(`[redis] command socket error: ${err.message}`);
        // Fail every in-flight command: their replies will never arrive.
        this.rejectAll(err);
      },
    );
  }

  private handleReply(reply: unknown): void {
    const next = this.pending.shift();
    if (!next) {
      // No waiter: the AUTH ack (RedisConnection sends AUTH itself) or a reply to
      // a command whose client was closed. Safe to drop.
      return;
    }
    clearTimeout(next.timer);
    if (next.dead) {
      // This command already timed out. Its reply still arrives in order, so it
      // must consume exactly this slot and nothing else — otherwise every later
      // reply would be handed to the wrong command.
      return;
    }
    if (reply instanceof Error) {
      next.reject(reply);
      return;
    }
    next.resolve(reply);
  }

  private rejectAll(err: Error): void {
    while (this.pending.length > 0) {
      const p = this.pending.shift()!;
      clearTimeout(p.timer);
      p.reject(err);
    }
  }

  /**
   * Send commands as ONE pipelined write and resolve with their replies in order.
   *
   * Pipelining matters here: the rate-limit read path is three commands, and
   * three round trips per request would put Redis latency directly in the
   * critical path of every write endpoint.
   */
  async pipeline(commands: string[][]): Promise<unknown[]> {
    if (this.closed) throw new Error("redis client closed");
    if (commands.length === 0) return [];

    const promises = commands.map(
      () =>
        new Promise<unknown>((resolve, reject) => {
          const entry: Pending = {
            resolve,
            reject,
            dead: false,
            // Replaced right below; declared here so the closure can flag `entry`.
            timer: undefined as unknown as ReturnType<typeof setTimeout>,
          };
          entry.timer = setTimeout(() => {
            // Keep the entry QUEUED (just flagged dead) so reply↔command
            // alignment survives: a late reply must consume this slot only.
            entry.dead = true;
            reject(new Error("redis command timed out"));
          }, COMMAND_TIMEOUT_MS);
          if (typeof entry.timer.unref === "function") entry.timer.unref();
          this.pending.push(entry);
        }),
    );

    this.connection.send(commands.map((c) => encodeCommand(c)).join(""));
    return Promise.all(promises);
  }

  /** Send a single command and resolve its reply. */
  async command(...args: string[]): Promise<unknown> {
    const [reply] = await this.pipeline([args]);
    return reply;
  }

  close(): void {
    this.closed = true;
    this.rejectAll(new Error("redis client closed"));
    this.connection.close();
  }
}
