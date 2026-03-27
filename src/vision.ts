import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "./logger";

const API_KEY = process.env.GOOGLE_AI_API_KEY;
if (!API_KEY) {
  throw new Error("GOOGLE_AI_API_KEY environment variable is required");
}

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const ANALYSIS_PROMPT = `You are analyzing a screenshot of a web page that was submitted as a sweepstakes/giveaway entry page.

Determine if this is a real, legitimate sweepstakes or giveaway entry page.

Look FOR (signs of legitimacy):
- Entry form (email, name fields, submit button)
- Prize description
- Official rules link
- Sponsor information
- Well-known brand involvement
- Clear start/end dates

RED FLAGS (signs of illegitimacy):
- Casino or gambling content
- Fake countdown timers with urgency manipulation
- Excessive pop-ups or overlays
- Malware or security warnings
- 404 or error pages
- Content completely unrelated to sweepstakes
- Suspicious download prompts
- Cryptocurrency or investment schemes

Respond with ONLY valid JSON (no markdown, no code fences):
{ "verdict": "approve" | "reject", "confidence": 0.0-1.0, "analysis": "brief reason for your verdict", "rejection_reason": "if rejecting, explain why", "entry_url": "direct entry URL if you can identify one from the page" }`;

export interface VisionResult {
  verdict: "approve" | "reject" | "needs_review";
  confidence: number;
  analysis: string;
  rejection_reason?: string;
  entry_url?: string;
}

export async function analyzeScreenshot(screenshotBuffer: Buffer): Promise<VisionResult> {
  logger.debug("Sending screenshot to Gemini for analysis");

  const base64 = screenshotBuffer.toString("base64");

  const result = await model.generateContent([
    { text: ANALYSIS_PROMPT },
    {
      inlineData: {
        mimeType: "image/png",
        data: base64,
      },
    },
  ]);

  const response = result.response;
  const text = response.text().trim();

  logger.debug("Gemini raw response", { text });

  try {
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(cleaned) as VisionResult;

    // Validate verdict
    if (!["approve", "reject", "needs_review"].includes(parsed.verdict)) {
      logger.warn("Invalid verdict from Gemini, defaulting to needs_review", { verdict: parsed.verdict });
      parsed.verdict = "needs_review";
    }

    // Clamp confidence
    parsed.confidence = Math.max(0, Math.min(1, parsed.confidence || 0.5));

    return parsed;
  } catch (err) {
    logger.error("Failed to parse Gemini response", { text, error: String(err) });
    return {
      verdict: "needs_review",
      confidence: 0.0,
      analysis: `Failed to parse AI response: ${text.slice(0, 200)}`,
    };
  }
}
