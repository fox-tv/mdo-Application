import type http from "http";
import type { Duplex } from "stream";
import { GoogleGenAI, Modality, type LiveServerMessage } from "@google/genai";
import { WebSocket, WebSocketServer } from "ws";
import { getGeminiClient } from "./geminiClient.ts";
import {
  filterTemplatesForUser,
  getDb,
  verifySessionToken,
} from "./store.ts";
import type { LiveVoiceName } from "../src/types.ts";

const ALLOWED_VOICES = new Set<LiveVoiceName>([
  "Zephyr",
  "Kore",
  "Puck",
  "Charon",
  "Fenrir",
]);

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = decodeURIComponent(part.slice(eq + 1).trim());
    if (key) result[key] = val;
  }
  return result;
}

function extractErrorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null) {
    const rec = err as Record<string, unknown>;
    if (typeof rec.message === "string" && rec.message) return rec.message;
    if (typeof rec.reason === "string" && rec.reason) return rec.reason;
    if (rec.error) {
      const nested = extractErrorText(rec.error);
      if (nested && nested !== "[object Object]") return nested;
    }
    try {
      const serialized = JSON.stringify(rec, Object.getOwnPropertyNames(rec));
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Ignore circular serialization
    }
  }
  return String(err);
}

function formatLiveErrorBn(err: unknown): string {
  const raw = extractErrorText(err);
  if (raw.includes("GEMINI_API_KEY_MISSING")) {
    return "সার্ভারে Gemini API কী কনফিগার করা নেই। Settings > Secrets প্যানেল থেকে API কী পরীক্ষা করুন।";
  }
  if (raw.includes("403") || raw.includes("PERMISSION_DENIED") || raw.includes("API_KEY_INVALID")) {
    return "API কী অনুমোদিত নয়। Settings > Secrets প্যানেল থেকে API কী যাচাই করুন।";
  }
  if (raw.includes("429") || raw.includes("RESOURCE_EXHAUSTED")) {
    return "অনুরোধের সীমা অতিক্রম করেছে। কিছুক্ষণ পর আবার চেষ্টা করুন।";
  }
  if (raw.includes("404") || raw.includes("NOT_FOUND")) {
    return `মডেল সংযোগ পাওয়া যায়নি (${raw.slice(0, 140)})।`;
  }
  return `ভয়েস সেশন ত্রুটি: ${raw.slice(0, 220)}`;
}

function safeSend(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

export function attachLiveVoiceServer(httpServer: http.Server): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    const rawUrl = req.url || "";
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl, "http://localhost");
    } catch {
      socket.destroy();
      return;
    }

    if (parsedUrl.pathname !== "/api/live-voice") {
      return;
    }

    const cookies = parseCookies(req.headers.cookie);
    const token =
      parsedUrl.searchParams.get("token")?.trim() ||
      cookies["mdo_session"] ||
      "";
    const user = verifySessionToken(token);

    if (!user) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (clientWs) => {
      wss.emit("connection", clientWs, req, user, parsedUrl);
    });
  });

  wss.on(
    "connection",
    async (
      clientWs: WebSocket,
      _req: http.IncomingMessage,
      user: NonNullable<ReturnType<typeof verifySessionToken>>,
      parsedUrl: URL
    ) => {
      const requestedVoice = parsedUrl.searchParams.get("voice") as LiveVoiceName | null;
      const voiceName: LiveVoiceName =
        requestedVoice && ALLOWED_VOICES.has(requestedVoice)
          ? requestedVoice
          : "Zephyr";

      const db = getDb();
      const org = db.organization;
      const accessibleTemplates = filterTemplatesForUser(db, user)
        .slice(0, 12)
        .map((t) => `${t.title} (${t.category})`)
        .join(", ");

      const systemInstruction = [
        `You are a helpful, courteous real-time Bengali and English voice assistant for "${org.nameBn}" (${db.siteConfig.websiteName}).`,
        `Current signed-in user: ${user.fullName}, designation: ${user.designation || "কর্মকর্তা"}, department: ${user.department || "সকল বিভাগ"}, role: ${user.role}.`,
        `Available institutional letter templates for this user: ${accessibleTemplates || "সাধারণ দাপ্তরিক পত্র"}.`,
        `Speak concisely, naturally, and professionally in Bengali when spoken to in Bengali, or in English if spoken to in English. Help the user brainstorm, dictate, refine, audit, or structure official letters and administrative correspondence.`,
      ].join("\n");

      let closed = false;
      let ai: GoogleGenAI;
      try {
        // Verify key availability via shared helper, then initialize Live API client with v1beta
        getGeminiClient();
        ai = new GoogleGenAI({
          apiKey: process.env.GEMINI_API_KEY,
          apiVersion: "v1beta",
          httpOptions: {
            headers: {
              "User-Agent": "aistudio-build",
            },
          },
        });
      } catch (err) {
        safeSend(clientWs, {
          type: "error",
          message: formatLiveErrorBn(err),
        });
        clientWs.close();
        return;
      }

      const apiClientInfo = (
        ai as unknown as {
          apiClient?: {
            getWebsocketBaseUrl?: () => string;
            getBaseUrl?: () => string;
            getApiVersion?: () => string;
          };
        }
      ).apiClient;

      const sessionPromise = ai.live
        .connect({
          model: "gemini-3.8-live",
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName,
                },
              },
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction,
          },
          callbacks: {
            onopen: () => {
              safeSend(clientWs, { type: "ready", voiceName });
            },
            onmessage: (message: LiveServerMessage) => {
              const content = message.serverContent;

              if (content?.inputTranscription?.text) {
                safeSend(clientWs, {
                  type: "inputTranscript",
                  text: content.inputTranscription.text,
                });
              }

              if (content?.outputTranscription?.text) {
                safeSend(clientWs, {
                  type: "outputTranscript",
                  text: content.outputTranscription.text,
                });
              }

              for (const part of content?.modelTurn?.parts ?? []) {
                if (part.inlineData?.data) {
                  safeSend(clientWs, {
                    type: "audio",
                    data: part.inlineData.data,
                  });
                }
              }

              if (content?.interrupted) {
                safeSend(clientWs, { type: "interrupted" });
              }

              if (content?.turnComplete) {
                safeSend(clientWs, { type: "turnComplete" });
              }
            },
            onerror: (err: unknown) => {
              const detail = extractErrorText(err);
              const wsBase = apiClientInfo?.getWebsocketBaseUrl?.() || "";
              const apiVer = apiClientInfo?.getApiVersion?.() || "";
              console.error("[liveVoiceBridge] Gemini Live error:", { detail, wsBase, apiVer });
              safeSend(clientWs, {
                type: "error",
                message: formatLiveErrorBn(err),
              });
            },
            onclose: (ev: unknown) => {
              const closeRec = (typeof ev === "object" && ev !== null ? ev : {}) as {
                code?: number;
                reason?: string;
              };
              if (closeRec.code && closeRec.code !== 1000) {
                console.error("[liveVoiceBridge] Gemini Live closed:", closeRec.code, closeRec.reason);
              }
              if (!closed && clientWs.readyState === WebSocket.OPEN) {
                safeSend(clientWs, {
                  type: "closed",
                  reason: closeRec.reason || undefined,
                });
                clientWs.close();
              }
            },
          },
        })
        .catch((err: unknown) => {
          console.error("[liveVoiceBridge] Connect failed:", err);
          safeSend(clientWs, {
            type: "error",
            message: formatLiveErrorBn(err),
          });
          clientWs.close();
          return null;
        });

      clientWs.on("message", async (rawData) => {
        try {
          const msg = JSON.parse(rawData.toString()) as {
            type?: string;
            data?: string;
            text?: string;
          };
          const session = await sessionPromise;
          if (!session || closed) return;

          if (msg.type === "audio" && typeof msg.data === "string" && msg.data) {
            session.sendRealtimeInput({
              audio: {
                data: msg.data,
                mimeType: "audio/pcm;rate=16000",
              },
            });
          } else if (msg.type === "text" && typeof msg.text === "string" && msg.text.trim()) {
            session.sendRealtimeInput({
              text: msg.text.trim(),
            });
          } else if (msg.type === "close") {
            closed = true;
            session.close();
            clientWs.close();
          }
        } catch (err) {
          console.error("[liveVoiceBridge] Message handling error:", err);
        }
      });

      clientWs.on("close", async () => {
        closed = true;
        try {
          const session = await sessionPromise;
          session?.close();
        } catch {
          // Ignore close errors
        }
      });
    }
  );
}
