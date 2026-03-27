import http from "node:http";
import { logger } from "./logger";
import { resetStaleItems, claimBatch, submitVerdict, QueueItem } from "./api-client";
import { launchBrowser, closeBrowser, takeScreenshot } from "./screenshotter";
import { analyzeScreenshot } from "./vision";

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "5", 10);
const CYCLE_INTERVAL_MS = parseInt(process.env.CYCLE_INTERVAL_MS || "1200000", 10);
const PORT = parseInt(process.env.PORT || "3000", 10);

let lastCycleAt: string | null = null;
let cycleCount = 0;
let isRunning = false;

// Health check server
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      status: "ok",
      lastCycleAt,
      cycleCount,
      isRunning,
    })
  );
});

function getTargetUrl(item: QueueItem): string {
  return item.enrichment_data?.entryUrl || item.source_url;
}

async function processItem(item: QueueItem): Promise<void> {
  const url = getTargetUrl(item);
  const title = item.enrichment_data?.title || item.raw_title || "unknown";
  logger.info("Processing item", { id: item.id, url, title });

  try {
    const screenshot = await takeScreenshot(url);
    logger.info("Screenshot captured", { id: item.id, bytes: screenshot.length });

    const result = await analyzeScreenshot(screenshot);
    logger.info("Analysis complete", {
      id: item.id,
      verdict: result.verdict,
      confidence: result.confidence,
    });

    await submitVerdict({
      id: item.id,
      verdict: result.verdict,
      analysis: result.analysis,
      confidence: result.confidence,
      rejection_reason: result.rejection_reason,
      entry_url: result.entry_url,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = message.includes("Timeout") || message.includes("timeout");

    logger.error("Failed to process item", { id: item.id, url, error: message });

    // Timeout → needs_review, not reject
    await submitVerdict({
      id: item.id,
      verdict: "needs_review",
      analysis: isTimeout ? `Page timed out after 15s: ${message}` : `Processing error: ${message}`,
      confidence: 0.0,
      rejection_reason: isTimeout ? undefined : message,
    }).catch((submitErr) => {
      logger.error("Failed to submit error verdict", { id: item.id, error: String(submitErr) });
    });
  }
}

async function runCycle(): Promise<void> {
  if (isRunning) {
    logger.warn("Cycle already running, skipping");
    return;
  }

  isRunning = true;
  cycleCount++;
  const cycleNum = cycleCount;

  logger.info(`=== Cycle ${cycleNum} starting ===`);

  try {
    // Step 1: Reset stale items
    await resetStaleItems();

    // Step 2: Claim batch
    const items = await claimBatch(BATCH_SIZE);

    if (items.length === 0) {
      logger.info("No items to process");
      return;
    }

    // Step 3: Launch browser
    await launchBrowser();

    // Step 4: Process items sequentially
    for (const item of items) {
      await processItem(item);
    }

    logger.info(`=== Cycle ${cycleNum} complete ===`, { processed: items.length });
  } catch (err) {
    logger.error(`Cycle ${cycleNum} failed`, { error: String(err) });
  } finally {
    // Close browser between cycles to prevent memory leaks
    await closeBrowser();
    lastCycleAt = new Date().toISOString();
    isRunning = false;
  }
}

async function main() {
  logger.info("sweeps-screenshot-validator starting", {
    batchSize: BATCH_SIZE,
    cycleIntervalMs: CYCLE_INTERVAL_MS,
    port: PORT,
  });

  // Start health check server
  server.listen(PORT, () => {
    logger.info(`Health check listening on port ${PORT}`);
  });

  // Run first cycle immediately
  await runCycle();

  // Schedule subsequent cycles
  setInterval(() => {
    runCycle().catch((err) => {
      logger.error("Unhandled cycle error", { error: String(err) });
    });
  }, CYCLE_INTERVAL_MS);
}

main().catch((err) => {
  logger.error("Fatal error", { error: String(err) });
  process.exit(1);
});
