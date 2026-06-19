// WP RT-3 — the publish seam used by backend write paths.
//
// Write paths (e.g. the comments route) call `publish(postId, event)` rather
// than touching pubsub or the stream endpoint directly. This single indirection
// keeps writers decoupled from transport and makes the eventual Redis swap
// (L10) a one-file change.

import type { ThreadEvent } from "./events.js";
import { pubsub } from "./pubsub.js";

export function publish(postId: string, event: ThreadEvent): void {
  pubsub.publish(postId, event);
}
