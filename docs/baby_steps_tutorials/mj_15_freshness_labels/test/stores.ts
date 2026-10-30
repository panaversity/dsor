// NEW IN STEP 15: stores the tests plant under the bound store, where a real connector or a
// cache would sit (step 15's README, decisions 5 and 8). Not a test file.
// DSoR has no cache. The tests plant one, to show that the label follows whatever served
// the read (DSOR-FRS-01b).
import type { Answer } from "../src/envelope.ts";
import type { Freshness } from "../src/freshness.ts";
import { memoryInvoices, type Invoice, type InvoiceStore } from "../src/invoice.ts";
import { call } from "../src/pipeline.ts";
import { buildRegistry, type Handler, type Registry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import {
  handlers,
  log,
  registryRunning,
  shipped,
  shippedInputs,
  shippedLabels,
  shippedRoles,
} from "./helpers.ts";

/** The shipped operations, reading through this store. */
export function registryOver(store: InvoiceStore): Registry {
  return buildRegistry(shipped, handlers, shippedRoles, shippedInputs, shippedLabels, store);
}

/** Calls "test.run" as this caller. Its code is the handler, and it reads through this store. */
export function runOver(
  store: InvoiceStore,
  who: RequestEnvelope,
  handler: Handler,
): Promise<Answer> {
  return call(registryRunning(handler, "Invoice", shippedLabels, store), log, who, "test.run", {
    invoice: "dsor://org_456/invoice/INV-1008",
  });
}

/** The answer's freshness, or "none" when it carries none. */
export function freshnessOf(answer: Answer): unknown {
  return "freshness" in answer ? answer.freshness : "none";
}

/**
 * The invoices in memory, with the label of each read replaced: the first read gets the
 * first label, the second read the second, and so on. The rows are memory's own.
 */
export function relabelled(labels: unknown[]): InvoiceStore {
  const inner = memoryInvoices();
  let reads = 0;
  // The label is the test's own, unchecked, so a test can plant a broken one.
  const next = (): Freshness => labels[Math.min(reads++, labels.length - 1)] as Freshness;
  return {
    get: async (tenant, id) => ({ ...(await inner.get(tenant, id)), freshness: next() }),
    list: async (tenant, after, count) => ({
      ...(await inner.list(tenant, after, count)),
      freshness: next(),
    }),
  };
}

/**
 * A cache in front of a store. Keyed by company and id, as DSOR-TEN-02a asks of every
 * cache. A read it serves is observational, with the time of the read it copied, never
 * "now" (step 15's README, decision 8). It caches single invoices, and passes lists on.
 */
export function cacheOver(inner: InvoiceStore): InvoiceStore {
  const kept = new Map<string, { invoice: Invoice; freshness: Freshness }>();
  return {
    get: async (tenant, id) => {
      // Both parts of the key, as one text that no company and id can share by accident.
      const key = JSON.stringify([tenant, id]);
      const hit = kept.get(key);
      if (hit !== undefined) {
        const freshness: Freshness = { ...hit.freshness, mode: "observational" };
        return { invoice: structuredClone(hit.invoice), freshness };
      }
      const read = await inner.get(tenant, id);
      if (read.invoice !== undefined) {
        kept.set(key, { invoice: structuredClone(read.invoice), freshness: read.freshness });
      }
      return read;
    },
    list: (tenant, after, count) => inner.list(tenant, after, count),
  };
}

/** Waits a few milliseconds, so the clock has moved on between two reads. */
export function aMomentLater(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}
