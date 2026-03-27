import { chromium, Browser, BrowserContext } from "playwright";
import { logger } from "./logger";

const PAGE_TIMEOUT = 15_000;
const VIEWPORT = { width: 1280, height: 800 };
const MAX_HEIGHT = 3000;

let browser: Browser | null = null;

export async function launchBrowser(): Promise<void> {
  if (browser) return;
  logger.info("Launching browser");
  browser = await chromium.launch({ headless: true });
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
    logger.info("Browser closed");
  }
}

async function dismissCookieBanners(context: BrowserContext, page: Awaited<ReturnType<BrowserContext["newPage"]>>) {
  const selectors = [
    'button:has-text("Accept")',
    'button:has-text("Accept All")',
    'button:has-text("I agree")',
    'button:has-text("I Agree")',
    'button:has-text("Got it")',
    'button:has-text("OK")',
    'button:has-text("Close")',
    '[id*="cookie"] button',
    '[class*="cookie"] button',
    '[id*="consent"] button',
    '[class*="consent"] button',
  ];

  for (const selector of selectors) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 500 })) {
        await btn.click({ timeout: 1000 });
        logger.debug("Dismissed cookie banner", { selector });
        await page.waitForTimeout(500);
        return;
      }
    } catch {
      // continue
    }
  }
}

export async function takeScreenshot(url: string): Promise<Buffer> {
  if (!browser) {
    throw new Error("Browser not launched");
  }

  const context = await browser.newContext({
    viewport: VIEWPORT,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });

  try {
    const page = await context.newPage();

    logger.debug("Navigating to URL", { url });
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_TIMEOUT,
    });

    // Wait a bit for dynamic content
    await page.waitForTimeout(2000);

    // Try to dismiss cookie banners
    await dismissCookieBanners(context, page);

    // Take screenshot
    const screenshot = await page.screenshot({
      fullPage: true,
      type: "png",
      clip: undefined,
    });

    // If the screenshot is too tall, retake with a clip
    const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
    if (bodyHeight > MAX_HEIGHT) {
      logger.debug("Page too tall, clipping screenshot", { bodyHeight, maxHeight: MAX_HEIGHT });
      const clipped = await page.screenshot({
        type: "png",
        clip: { x: 0, y: 0, width: VIEWPORT.width, height: MAX_HEIGHT },
      });
      return Buffer.from(clipped);
    }

    return Buffer.from(screenshot);
  } finally {
    await context.close().catch(() => {});
  }
}
