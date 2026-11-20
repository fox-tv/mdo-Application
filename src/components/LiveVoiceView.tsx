import React, { useCallback, useEffect, useRef, useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";
import {
  Cloud,
  FilePlus2,
  Mic,
  MicOff,
  PhoneOff,
  Send,
  Trash2,
  Volume2,
} from "lucide-react";
import { getAuthToken } from "../utils/api";
import { toBengaliDigits } from "../utils/bengali";
import {
  deleteVoiceSessionFromCloud,
  saveVoiceSessionToCloud,
  subscribeVoiceSessions,
} from "../lib/firebase";
import type {
  CloudVoiceSession,
  LiveVoiceName,
  OrganizationProfile,
  PublicUser,
  VoiceTranscriptTurn,
} from "../types";

interface LiveVoiceViewProps {
  user: PublicUser;
  org: OrganizationProfile;
  firebaseUser: FirebaseUser | null;
  isAdmin?: boolean;
  primaryColor?: string;
  onConnectGoogleCloud?: () => Promise<void>;
  onCreateLetterFromVoice: (contentText: string, titleHint?: string) => void;
}

const VOICE_OPTIONS: { id: LiveVoiceName; label: string; note: string }[] = [
  { id: "Zephyr", label: "জেফির (Zephyr)", note: "স্বাভাবিক ও স্পষ্ট" },
  { id: "Kore", label: "কোরে (Kore)", note: "সৌম্য ও দাপ্তরিক" },
  { id: "Puck", label: "পাক (Puck)", note: "প্রাণবন্ত ও দ্রুত" },
  { id: "Charon", label: "ক্যারন (Charon)", note: "গভীর ও গম্ভীর" },
  { id: "Fenrir", label: "ফেনরির (Fenrir)", note: "দৃঢ় ও সুস্পষ্ট" },
];

function float32ToPcm16Base64(float32: Float32Array): string {
  const pcm = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64Pcm16ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const float32 = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  return float32;
}

export const LiveVoiceView: React.FC<LiveVoiceViewProps> = ({
  user,
  org,
  firebaseUser,
  isAdmin = false,
  primaryColor = "#1E3A8A",
  onConnectGoogleCloud,
  onCreateLetterFromVoice,
}) => {
  const [selectedVoice, setSelectedVoice] = useState<LiveVoiceName>("Zephyr");
  const [connectionState, setConnectionState] = useState<
    "idle" | "connecting" | "connected"
  >("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [noticeMsg, setNoticeMsg] = useState("");
  const [textInput, setTextInput] = useState("");
  const [turns, setTurns] = useState<VoiceTranscriptTurn[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>(
    () => `vs-${Date.now()}`
  );

  const [cloudSessions, setCloudSessions] = useState<CloudVoiceSession[]>([]);
  const [savingToCloud, setSavingToCloud] = useState(false);
  const [connectingCloud, setConnectingCloud] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const isMutedRef = useRef<boolean>(false);
  const activeTurnRoleRef = useRef<"user" | "assistant" | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  useEffect(() => {
    if (!isAdmin || !firebaseUser) {
      setCloudSessions([]);
      return;
    }
    const unsubscribe = subscribeVoiceSessions(
      firebaseUser.uid,
      (items) => setCloudSessions(items),
      (err) => setErrorMsg(err.message)
    );
    return () => unsubscribe();
  }, [isAdmin, firebaseUser]);

  const stopQueuedAudio = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // Ignore already-stopped nodes
      }
    }
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setAssistantSpeaking(false);
  }, []);

  const stopSession = useCallback(() => {
    stopQueuedAudio();

    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
      try {
        processorRef.current.disconnect();
      } catch {
        // Ignore
      }
      processorRef.current = null;
    }

    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        // Ignore
      }
      sourceNodeRef.current = null;
    }

    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }

    if (inputAudioCtxRef.current) {
      void inputAudioCtxRef.current.close().catch(() => {});
      inputAudioCtxRef.current = null;
    }

    if (outputAudioCtxRef.current) {
      void outputAudioCtxRef.current.close().catch(() => {});
      outputAudioCtxRef.current = null;
    }

    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "close" }));
        }
        wsRef.current.close();
      } catch {
        // Ignore
      }
      wsRef.current = null;
    }

    activeTurnRoleRef.current = null;
    setConnectionState("idle");
    setIsMuted(false);
  }, [stopQueuedAudio]);

  useEffect(() => {
    return () => {
      stopSession();
    };
  }, [stopSession]);

  const appendTranscriptDelta = useCallback(
    (role: "user" | "assistant", deltaText: string) => {
      const cleaned = deltaText;
      if (!cleaned.trim()) return;

      setTurns((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === role && activeTurnRoleRef.current === role) {
          const needsSpace =
            last.text.length > 0 &&
            !/\s$/.test(last.text) &&
            !/^\s/.test(cleaned) &&
            !/^[.,!?।]/.test(cleaned);
          const merged = `${last.text}${needsSpace ? " " : ""}${cleaned}`;
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              text: merged,
            },
          ];
        }
        activeTurnRoleRef.current = role;
        return [
          ...prev,
          {
            id: `turn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role,
            text: cleaned.trimStart(),
            timestamp: new Date().toISOString(),
          },
        ];
      });
    },
    []
  );

  const playPcm24kChunk = useCallback((base64Audio: string) => {
    const outCtx = outputAudioCtxRef.current;
    if (!outCtx) return;

    if (outCtx.state === "suspended") {
      void outCtx.resume().catch(() => {});
    }

    const float32 = base64Pcm16ToFloat32(base64Audio);
    if (float32.length === 0) return;

    const buffer = outCtx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const src = outCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(outCtx.destination);

    const startTime = Math.max(outCtx.currentTime + 0.02, nextStartTimeRef.current);
    src.start(startTime);
    nextStartTimeRef.current = startTime + buffer.duration;
    setAssistantSpeaking(true);

    activeSourcesRef.current.add(src);
    src.onended = () => {
      activeSourcesRef.current.delete(src);
      if (activeSourcesRef.current.size === 0) {
        setAssistantSpeaking(false);
      }
    };
  }, []);

  const startSession = async () => {
    setErrorMsg("");
    setNoticeMsg("");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setErrorMsg(
        "এই ব্রাউজার বা পরিবেশে মাইক্রোফোন অ্যাক্সেস সমর্থিত নয়।"
      );
      return;
    }

    setConnectionState("connecting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      inputAudioCtxRef.current = inputCtx;
      outputAudioCtxRef.current = outputCtx;
      nextStartTimeRef.current = 0;

      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const token = getAuthToken();
      const qs = new URLSearchParams({ voice: selectedVoice });
      if (token) qs.set("token", token);
      const ws = new WebSocket(`${proto}//${window.location.host}/api/live-voice?${qs.toString()}`);
      wsRef.current = ws;

      ws.onopen = () => {
        const src = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        sourceNodeRef.current = src;
        processorRef.current = processor;

        src.connect(processor);
        processor.connect(inputCtx.destination);

        processor.onaudioprocess = (ev) => {
          if (
            isMutedRef.current ||
            !wsRef.current ||
            wsRef.current.readyState !== WebSocket.OPEN
          ) {
            return;
          }
          const samples = ev.inputBuffer.getChannelData(0);
          const base64 = float32ToPcm16Base64(samples);
          wsRef.current.send(JSON.stringify({ type: "audio", data: base64 }));
        };
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type?: string;
            data?: string;
            text?: string;
            message?: string;
          };

          if (msg.type === "ready") {
            setConnectionState("connected");
          } else if (msg.type === "audio" && msg.data) {
            playPcm24kChunk(msg.data);
          } else if (msg.type === "inputTranscript" && msg.text) {
            appendTranscriptDelta("user", msg.text);
          } else if (msg.type === "outputTranscript" && msg.text) {
            appendTranscriptDelta("assistant", msg.text);
          } else if (msg.type === "interrupted") {
            stopQueuedAudio();
            activeTurnRoleRef.current = null;
          } else if (msg.type === "turnComplete") {
            activeTurnRoleRef.current = null;
          } else if (msg.type === "error" && msg.message) {
            setErrorMsg(msg.message);
            stopSession();
          } else if (msg.type === "closed") {
            stopSession();
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onerror = () => {
        setErrorMsg("ভয়েস সেশন সংযোগে সমস্যা হয়েছে। আবার চেষ্টা করুন।");
        stopSession();
      };

      ws.onclose = () => {
        stopSession();
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("notallowed")) {
        setErrorMsg(
          "মাইক্রোফোন ব্যবহারের অনুমতি পাওয়া যায়নি। ব্রাউজার থেকে মাইক্রোফোন অনুমতি দিয়ে পুনরায় চেষ্টা করুন।"
        );
      } else {
        setErrorMsg(`ভয়েস সেশন চালু করা যায়নি: ${msg}`);
      }
      stopSession();
    }
  };

  const handleSendTextMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = textInput.trim();
    if (!cleaned || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }
    activeTurnRoleRef.current = null;
    setTurns((prev) => [
      ...prev,
      {
        id: `turn-${Date.now()}`,
        role: "user",
        text: cleaned,
        timestamp: new Date().toISOString(),
      },
    ]);
    wsRef.current.send(JSON.stringify({ type: "text", text: cleaned }));
    setTextInput("");
  };

  const handleSaveSessionToCloud = async () => {
    if (!firebaseUser || turns.length === 0) return;
    setErrorMsg("");
    setNoticeMsg("");
    setSavingToCloud(true);
    try {
      const firstUserTurn = turns.find((t) => t.role === "user")?.text || "";
      const title =
        firstUserTurn.slice(0, 80) ||
        `ভয়েস কথোপকথন (${new Date().toLocaleDateString("bn-BD")})`;
      await saveVoiceSessionToCloud(
        {
          id: activeSessionId,
          title,
          voiceName: selectedVoice,
          turns,
          summary: turns[turns.length - 1]?.text.slice(0, 300) || "",
        },
        firebaseUser.uid
      );
      setNoticeMsg("কথোপকথনটি ক্লাউড ডাটাবেসে সংরক্ষণ করা হয়েছে।");
      setTimeout(() => setNoticeMsg(""), 3000);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : "ক্লাউড ডাটাবেসে সংরক্ষণ করা যায়নি।"
      );
    } finally {
      setSavingToCloud(false);
    }
  };

  const handleConnectGoogle = async () => {
    if (!isAdmin || !onConnectGoogleCloud) return;
    setErrorMsg("");
    setConnectingCloud(true);
    try {
      await onConnectGoogleCloud();
      setNoticeMsg("Google ক্লাউড ডাটাবেস সংযোগ সম্পন্ন হয়েছে।");
      setTimeout(() => setNoticeMsg(""), 2600);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : "Google অ্যাকাউন্ট সংযুক্ত করা যায়নি।"
      );
    } finally {
      setConnectingCloud(false);
    }
  };

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Page Header */}
      <div
        data-section="voice-header"
        className="bg-white border border-stone-200 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4"
      >
        <div>
          <p className="text-xs font-medium text-stone-500">
            {org.nameBn} · {user.fullName}
          </p>
          <h1 className="mt-0.5 text-2xl font-bold text-stone-900 tracking-tight">
            রিয়েল-টাইম ভয়েস কথোপকথন
          </h1>
          <p className="mt-1 text-xs text-stone-600 max-w-2xl">
            সরাসরি কথা বলে দাপ্তরিক পত্রের খসড়া আলোচনা, বক্তব্য পরিমার্জন ও প্রশাসনিক সহায়তা নিন এবং প্রয়োজনে এক ক্লিকেই চিঠির সম্পাদকে পাঠান।
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {connectionState === "idle" ? (
            <button
              type="button"
              data-action="start-live-voice"
              onClick={() => void startSession()}
              style={{ backgroundColor: primaryColor }}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-lg text-xs font-semibold text-white hover:opacity-90 transition-opacity whitespace-nowrap cursor-pointer"
            >
              <Mic className="w-4 h-4" />
              <span>কথোপকথন শুরু করুন</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setIsMuted((prev) => !prev)}
                className="inline-flex items-center gap-1.5 h-11 px-4 rounded-lg border border-stone-300 bg-white text-xs font-semibold text-stone-800 hover:bg-stone-50 whitespace-nowrap cursor-pointer"
              >
                {isMuted ? (
                  <>
                    <MicOff className="w-4 h-4 text-amber-700" />
                    <span>আনমিউট করুন</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4" style={{ color: primaryColor }} />
                    <span>মিউট করুন</span>
                  </>
                )}
              </button>

              <button
                type="button"
                data-action="stop-live-voice"
                onClick={stopSession}
                className="inline-flex items-center gap-1.5 h-11 px-4 rounded-lg bg-red-600 text-xs font-semibold text-white hover:bg-red-700 whitespace-nowrap cursor-pointer"
              >
                <PhoneOff className="w-4 h-4" />
                <span>সেশন শেষ করুন</span>
              </button>
            </>
          )}
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800"
        >
          {errorMsg}
        </div>
      )}

      {noticeMsg && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800"
        >
          {noticeMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Live Transcript & Real-Time Controls */}
        <section
          data-section="voice-transcript"
          className="lg:col-span-8 bg-white border border-stone-200 rounded-xl overflow-hidden flex flex-col"
        >
          <div className="px-5 py-3.5 border-b border-stone-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-stone-700">
              <Volume2 className="w-4 h-4" style={{ color: primaryColor }} />
              <span className="font-semibold">
                {connectionState === "connected"
                  ? assistantSpeaking
                    ? "এআই উত্তর বলছে..."
                    : isMuted
                    ? "সংযুক্ত (মাইক্রোফোন মিউট)"
                    : "সরাসরি সংযুক্ত — আপনি এখন কথা বলতে পারেন"
                  : connectionState === "connecting"
                  ? "মাইক্রোফোন ও লাইভ সেশন সংযুক্ত হচ্ছে..."
                  : "সেশন প্রস্তুত"}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {isAdmin && firebaseUser && turns.length > 0 && (
                <button
                  type="button"
                  onClick={() => void handleSaveSessionToCloud()}
                  disabled={savingToCloud}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-60 cursor-pointer"
                >
                  <Cloud className="w-3.5 h-3.5" style={{ color: primaryColor }} />
                  <span>{savingToCloud ? "সংরক্ষণ হচ্ছে..." : "ক্লাউডে সংরক্ষণ"}</span>
                </button>
              )}

              {turns.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setTurns([]);
                    setActiveSessionId(`vs-${Date.now()}`);
                    activeTurnRoleRef.current = null;
                  }}
                  className="h-8 px-3 rounded-lg border border-stone-200 text-xs text-stone-600 hover:bg-stone-50 cursor-pointer"
                >
                  নতুন কথোপকথন
                </button>
              )}
            </div>
          </div>

          <div className="p-5 min-h-[380px] max-h-[520px] overflow-y-auto space-y-4">
            {turns.length === 0 ? (
              <div className="py-16 text-center max-w-md mx-auto space-y-2">
                <p className="text-sm font-semibold text-stone-900">
                  এখনো কোনো কথোপকথন শুরু হয়নি
                </p>
                <p className="text-xs text-stone-600 leading-relaxed">
                  উপরের “কথোপকথন শুরু করুন” বোতামে ক্লিক করে বাংলা বা ইংরেজিতে সরাসরি কথা বলুন। যেমন: “হিসাব শাখার জন্য একটি অডিট সংক্রান্ত চিঠির খসড়া তৈরি করে দিন।”
                </p>
              </div>
            ) : (
              turns.map((turn) => (
                <div
                  key={turn.id}
                  className={`flex flex-col ${
                    turn.role === "user" ? "items-end" : "items-start"
                  }`}
                >
                  <div
                    className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                      turn.role === "user"
                        ? "bg-stone-900 text-white"
                        : "bg-stone-50 border border-stone-200 text-stone-900"
                    }`}
                  >
                    <p className="text-[11px] font-medium opacity-75 mb-1">
                      {turn.role === "user" ? user.fullName : "ভয়েস সহকারী"}
                    </p>
                    <p className="whitespace-pre-wrap break-words">{turn.text}</p>

                    {turn.role === "assistant" && turn.text.trim().length > 15 && (
                      <div className="mt-2.5 pt-2 border-t border-stone-200/80 flex justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            onCreateLetterFromVoice(
                              turn.text,
                              "ভয়েস নির্দেশনায় প্রস্তুতকৃত পত্র"
                            )
                          }
                          className="inline-flex items-center gap-1 text-xs font-semibold hover:underline cursor-pointer"
                          style={{ color: primaryColor }}
                        >
                          <FilePlus2 className="w-3.5 h-3.5" />
                          <span>এই বক্তব্য দিয়ে পত্র তৈরি করুন</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={transcriptEndRef} />
          </div>

          <form
            onSubmit={handleSendTextMessage}
            className="p-4 border-t border-stone-200 bg-stone-50/70 flex items-center gap-2.5"
          >
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              disabled={connectionState !== "connected"}
              placeholder={
                connectionState === "connected"
                  ? "কথার পাশাপাশি প্রয়োজনে এখানে লিখিত প্রশ্ন পাঠান..."
                  : "লিখিত প্রশ্ন পাঠাতে প্রথমে কথোপকথন শুরু করুন"
              }
              className="flex-1 h-10 rounded-lg border border-stone-300 bg-white px-3.5 text-sm text-stone-900 placeholder:text-stone-400 disabled:bg-stone-100 focus:outline-none focus:border-[#1E3A8A]"
            />
            <button
              type="submit"
              disabled={connectionState !== "connected" || !textInput.trim()}
              style={{ backgroundColor: primaryColor }}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>পাঠান</span>
            </button>
          </form>
        </section>

        {/* Right: Voice Persona & Cloud Saved Voice Sessions */}
        <aside className="lg:col-span-4 space-y-5">
          <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-bold text-stone-900">কণ্ঠস্বর নির্বাচন</h2>
            <p className="text-xs text-stone-600">
              সেশন শুরু করার আগে আপনার পছন্দের কণ্ঠস্বর বেছে নিন।
            </p>
            <div className="space-y-2">
              {VOICE_OPTIONS.map((v) => {
                const active = selectedVoice === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    disabled={connectionState !== "idle"}
                    onClick={() => setSelectedVoice(v.id)}
                    style={
                      active
                        ? { borderColor: primaryColor, backgroundColor: `${primaryColor}0D` }
                        : undefined
                    }
                    className={`w-full px-3.5 py-2.5 rounded-lg border text-left flex items-center justify-between gap-2 transition-colors cursor-pointer disabled:opacity-60 ${
                      active
                        ? "border-[#1E3A8A]"
                        : "border-stone-200 hover:bg-stone-50"
                    }`}
                  >
                    <span className="text-xs font-semibold text-stone-900">
                      {v.label}
                    </span>
                    <span className="text-[11px] text-stone-500">{v.note}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {isAdmin ? (
            <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-stone-900">
                  সংরক্ষিত ভয়েস কথোপকথন
                </h2>
                {firebaseUser && (
                  <span className="text-xs text-stone-500 tabular-nums">
                    {toBengaliDigits(cloudSessions.length)}টি
                  </span>
                )}
              </div>

              {!firebaseUser ? (
                onConnectGoogleCloud ? (
                  <div className="space-y-3">
                    <p className="text-xs text-stone-600 leading-relaxed">
                      ভয়েস কথোপকথনের বিবরণ ক্লাউড ডাটাবেসে স্থায়ীভাবে সংরক্ষণ করতে Google অ্যাকাউন্ট সংযুক্ত করুন।
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleConnectGoogle()}
                      disabled={connectingCloud}
                      style={{ backgroundColor: primaryColor }}
                      className="w-full h-10 rounded-lg text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60 cursor-pointer"
                    >
                      {connectingCloud
                        ? "সংযুক্ত হচ্ছে..."
                        : "Google ক্লাউড সিঙ্ক যুক্ত করুন"}
                    </button>
                  </div>
                ) : null
              ) : cloudSessions.length === 0 ? (
                <p className="text-xs text-stone-500 leading-relaxed">
                  এখনো কোনো ভয়েস কথোপকথন ক্লাউডে সংরক্ষিত হয়নি। কথোপকথন শেষে “ক্লাউডে সংরক্ষণ” ব্যবহার করুন।
                </p>
              ) : (
                <div className="divide-y divide-stone-200">
                  {cloudSessions.map((sess) => (
                    <div
                      key={sess.id}
                      className="py-2.5 flex items-start justify-between gap-2"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setActiveSessionId(sess.id);
                          setSelectedVoice(sess.voiceName);
                          setTurns(sess.turns || []);
                        }}
                        className="text-left min-w-0 flex-1 cursor-pointer hover:underline"
                      >
                        <p className="text-xs font-semibold text-stone-900 truncate">
                          {sess.title}
                        </p>
                        <p className="text-[11px] text-stone-500 mt-0.5 tabular-nums">
                          {sess.voiceName} · {toBengaliDigits(sess.turns?.length || 0)}টি বার্তা
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteVoiceSessionFromCloud(sess.id)}
                        aria-label="কথোপকথন মুছে ফেলুন"
                        className="p-1.5 text-stone-400 hover:text-red-600 cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-2.5">
              <h2 className="text-sm font-bold text-stone-900">
                ভয়েস সহায়তা ব্যবহারের নিয়ম
              </h2>
              <p className="text-xs text-stone-600 leading-relaxed">
                মাইক্রোফোনে বাংলায় নির্দেশনা দিয়ে সরাসরি খসড়া তৈরি করুন এবং প্রতিটি উত্তরের নিচে থাকা “এই বক্তব্য দিয়ে পত্র তৈরি করুন” বাটনে ক্লিক করে চিঠি সম্পাদকে নিয়ে যান।
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
