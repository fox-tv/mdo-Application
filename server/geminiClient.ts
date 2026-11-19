import {
  GoogleGenAI,
  ThinkingLevel,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from "@google/genai";

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY_MISSING");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function isRateLimitError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  const errStatus =
    typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status?: unknown }).status)
      : undefined;
  return errStatus === 429 || raw.includes("429") || raw.includes("RESOURCE_EXHAUSTED");
}

function isTransientGeminiError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  const errStatus =
    typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status?: unknown }).status)
      : undefined;

  return (
    name === "AbortError" ||
    name === "TimeoutError" ||
    errStatus === 429 ||
    errStatus === 503 ||
    errStatus === 500 ||
    errStatus === 502 ||
    errStatus === 504 ||
    raw.includes("429") ||
    raw.includes("RESOURCE_EXHAUSTED") ||
    raw.includes('"code":503') ||
    raw.includes("UNAVAILABLE") ||
    raw.toLowerCase().includes("high demand") ||
    raw.toLowerCase().includes("try again later") ||
    raw.toLowerCase().includes("fetch failed") ||
    raw.toLowerCase().includes("econnreset") ||
    raw.toLowerCase().includes("aborted")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const modelCooldownUntil = new Map<string, number>();

export async function generateContentResilient(
  ai: GoogleGenAI,
  params: Omit<GenerateContentParameters, "model"> & { model?: string },
  options?: {
    models?: string[];
    maxAttemptsPerModel?: number;
  }
): Promise<GenerateContentResponse> {
  const baseModels = options?.models ?? [
    params.model || "gemini-4-hydrogen",
    "gemini-3.1-flash-lite",
  ];
  const now = Date.now();
  const readyModels = baseModels.filter((m) => (modelCooldownUntil.get(m) || 0) <= now);
  const modelsToTry = readyModels.length > 0 ? readyModels : baseModels;
  const maxAttempts = options?.maxAttemptsPerModel ?? 3;
  let lastError: unknown;

  for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
    const model = modelsToTry[mIdx];
    const hasFallbackModel = mIdx < modelsToTry.length - 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const config = params.config ? { ...params.config } : {};
        if (model === "gemini-3.1-flash-lite" && config.thinkingConfig) {
          config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
        }
        if (hasFallbackModel && !config.abortSignal) {
          config.abortSignal = AbortSignal.timeout(45_000);
        }
        return await ai.models.generateContent({
          ...params,
          model,
          config,
        });
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[geminiClient] ${model} attempt ${attempt} failed:`, msg.slice(0, 300));
        if (!isTransientGeminiError(err)) {
          throw err;
        }
        const is429 = isRateLimitError(err);
        const hasMoreAttemptsThisModel = attempt < maxAttempts;
        if (!hasMoreAttemptsThisModel && !hasFallbackModel) {
          modelCooldownUntil.set(model, Date.now() + (is429 ? 25_000 : 20_000));
          throw err;
        }
        if (is429 && hasFallbackModel) {
          modelCooldownUntil.set(model, Date.now() + 25_000);
          break;
        }
        if (!hasMoreAttemptsThisModel) {
          modelCooldownUntil.set(model, Date.now() + 20_000);
        }
        await sleep(is429 ? 1500 * attempt : hasMoreAttemptsThisModel ? 1200 * attempt : 200);
      }
    }
  }

  throw lastError;
}
