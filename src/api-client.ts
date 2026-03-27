import { logger } from "./logger";

const API_URL = process.env.SWEEPS_API_URL || "https://sweepstoday.com";
const CRON_SECRET = process.env.CRON_SECRET;

if (!CRON_SECRET) {
  throw new Error("CRON_SECRET environment variable is required");
}

const headers = {
  Authorization: `Bearer ${CRON_SECRET}`,
  "Content-Type": "application/json",
};

export interface QueueItem {
  id: string;
  source_url: string;
  enrichment_data?: {
    title?: string;
    entryUrl?: string;
    [key: string]: unknown;
  };
  raw_title?: string;
  [key: string]: unknown;
}

export interface VerdictPayload {
  id: string;
  verdict: "approve" | "reject" | "needs_review";
  analysis: string;
  confidence: number;
  screenshot_url?: string;
  rejection_reason?: string;
  entry_url?: string;
}

export async function resetStaleItems(): Promise<{ reset_count: number }> {
  logger.info("Resetting stale queue items");
  const res = await fetch(`${API_URL}/api/screenshot-queue`, {
    method: "PATCH",
    headers,
  });
  if (!res.ok) {
    throw new Error(`PATCH /api/screenshot-queue failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { ok: boolean; reset_count: number };
  logger.info("Stale items reset", { reset_count: data.reset_count });
  return { reset_count: data.reset_count };
}

export async function claimBatch(limit: number): Promise<QueueItem[]> {
  logger.info("Claiming batch", { limit });
  const res = await fetch(`${API_URL}/api/screenshot-queue?limit=${limit}`, {
    method: "GET",
    headers,
  });
  if (!res.ok) {
    throw new Error(`GET /api/screenshot-queue failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { items?: QueueItem[] };
  const items: QueueItem[] = data.items || [];
  logger.info("Claimed items", { count: items.length });
  return items;
}

export async function submitVerdict(payload: VerdictPayload): Promise<void> {
  logger.info("Submitting verdict", { id: payload.id, verdict: payload.verdict });
  const res = await fetch(`${API_URL}/api/screenshot-queue`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`POST /api/screenshot-queue failed: ${res.status} ${res.statusText} — ${body}`);
  }
  logger.info("Verdict submitted", { id: payload.id });
}
