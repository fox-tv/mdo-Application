import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Bot,
  Check,
  Mic,
  MicOff,
  Plus,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Trash2,
  Undo2,
} from "lucide-react";
import { DEFAULT_AI_ASSISTANT_CONFIG } from "../data/templates";
import type {
  AiAssistantActionLog,
  AiAssistantConfig,
  AiAssistantMessage,
  AiAssistantPendingProposal,
  DepartmentItem,
  LetterTemplate,
  OrganizationProfile,
  PublicUser,
  QuickPhrase,
  SavedLetter,
  SiteConfig,
  SitePlugin,
} from "../types";
import { apiRequest } from "../utils/api";

export interface AssistantSyncPayload {
  siteConfig: SiteConfig;
  aiAssistantConfig: AiAssistantConfig;
  organization: OrganizationProfile;
  departments: DepartmentItem[];
  templates: LetterTemplate[];
  quickPhrases: QuickPhrase[];
  plugins: SitePlugin[];
  users: PublicUser[];
  letters: SavedLetter[];
}

interface AdminAiAssistantPanelProps {
  pluginEnabled: boolean;
  onSyncWorkspace: (sync: AssistantSyncPayload) => void;
  onConfigUpdated?: () => void;
  onOpenPluginStudio: () => void;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionInstanceLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getSpeechRecognitionCtor():
  | (new () => SpeechRecognitionInstanceLike)
  | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionInstanceLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstanceLike;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const commaIdx = result.indexOf(",");
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error("অডিও পড়া যায়নি।"));
    reader.readAsDataURL(blob);
  });
}

export const AdminAiAssistantPanel: React.FC<AdminAiAssistantPanelProps> = ({
  pluginEnabled,
  onSyncWorkspace,
  onConfigUpdated,
  onOpenPluginStudio,
}) => {
  const [config, setConfig] = useState<AiAssistantConfig>(
    DEFAULT_AI_ASSISTANT_CONFIG
  );
  const [configDraft, setConfigDraft] = useState<AiAssistantConfig>(
    DEFAULT_AI_ASSISTANT_CONFIG
  );
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);

  const [messages, setMessages] = useState<AiAssistantMessage[]>(() => {
    try {
      const raw = sessionStorage.getItem("mdo_admin_ai_messages");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignore storage errors
    }
    return [];
  });
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [newQuickCmd, setNewQuickCmd] = useState("");

  const [notice, setNotice] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Voice capture states
  const [voiceMode, setVoiceMode] = useState<"idle" | "listening" | "transcribing">("idle");
  const recognitionRef = useRef<SpeechRecognitionInstanceLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoadingConfig(true);
      try {
        const res = await apiRequest<{ aiAssistantConfig: AiAssistantConfig }>(
          "/api/admin/ai-assistant/config"
        );
        if (active && res.aiAssistantConfig) {
          setConfig(res.aiAssistantConfig);
          setConfigDraft(res.aiAssistantConfig);
        }
      } catch (err) {
        if (active) {
          setErrorMsg(
            err instanceof Error
              ? err.message
              : "এআই অ্যাসিস্ট্যান্ট কনফিগারেশন লোড করা যায়নি।"
          );
        }
      } finally {
        if (active) setLoadingConfig(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    try {
      if (messages.length > 0) {
        sessionStorage.setItem(
          "mdo_admin_ai_messages",
          JSON.stringify(messages.slice(-40))
        );
      } else {
        sessionStorage.removeItem("mdo_admin_ai_messages");
      }
    } catch {
      // Ignore storage quota errors
    }
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const flashNotice = (msg: string) => {
    setErrorMsg("");
    setNotice(msg);
    setTimeout(() => setNotice(""), 3000);
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    setErrorMsg("");
    try {
      const res = await apiRequest<{ aiAssistantConfig: AiAssistantConfig }>(
        "/api/admin/ai-assistant/config",
        {
          method: "PUT",
          body: JSON.stringify(configDraft),
        }
      );
      setConfig(res.aiAssistantConfig);
      setConfigDraft(res.aiAssistantConfig);
      onConfigUpdated?.();
      flashNotice("এআই অ্যাসিস্ট্যান্ট কাস্টমাইজেশন সংরক্ষণ করা হয়েছে।");
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "কনফিগারেশন সংরক্ষণ করা যায়নি।"
      );
    } finally {
      setSavingConfig(false);
    }
  };

  const handleResetConfig = async () => {
    setSavingConfig(true);
    setErrorMsg("");
    try {
      const res = await apiRequest<{ aiAssistantConfig: AiAssistantConfig }>(
        "/api/admin/ai-assistant/reset",
        { method: "POST" }
      );
      setConfig(res.aiAssistantConfig);
      setConfigDraft(res.aiAssistantConfig);
      onConfigUpdated?.();
      flashNotice("অ্যাসিস্ট্যান্টের সেটিংস ডিফল্ট অবস্থায় ফিরিয়ে আনা হয়েছে।");
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "রিসেট করা যায়নি।"
      );
    } finally {
      setSavingConfig(false);
    }
  };

  const handleAddQuickCmd = () => {
    const clean = newQuickCmd.trim();
    if (!clean) return;
    setConfigDraft({
      ...configDraft,
      quickCommands: [...(configDraft.quickCommands || []), clean].slice(0, 8),
    });
    setNewQuickCmd("");
  };

  const handleRemoveQuickCmd = (idx: number) => {
    setConfigDraft({
      ...configDraft,
      quickCommands: (configDraft.quickCommands || []).filter((_, i) => i !== idx),
    });
  };

  const stopVoiceCapture = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setVoiceMode("idle");
      return;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  const handleToggleVoice = async () => {
    setErrorMsg("");
    if (voiceMode !== "idle") {
      stopVoiceCapture();
      return;
    }

    const SpeechCtor = getSpeechRecognitionCtor();
    if (SpeechCtor) {
      try {
        const rec = new SpeechCtor();
        rec.lang = "bn-BD";
        rec.interimResults = false;
        rec.continuous = false;
        rec.onresult = (ev) => {
          let spoken = "";
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            if (ev.results[i].isFinal) {
              spoken += ev.results[i][0].transcript + " ";
            }
          }
          const clean = spoken.trim();
          if (clean) {
            setInputText((prev) => (prev ? `${prev.trim()} ${clean}` : clean));
          }
        };
        rec.onerror = (ev) => {
          if (ev.error && ev.error !== "aborted" && ev.error !== "no-speech") {
            setErrorMsg("মাইক্রোফোন ব্যবহার করতে ব্রাউজার অনুমতি প্রয়োজন।");
          }
          setVoiceMode("idle");
        };
        rec.onend = () => {
          recognitionRef.current = null;
          setVoiceMode("idle");
        };
        recognitionRef.current = rec;
        setVoiceMode("listening");
        rec.start();
        return;
      } catch {
        recognitionRef.current = null;
        setVoiceMode("idle");
      }
    }

    // Fallback: record audio via MediaRecorder and transcribe via server Gemini 3.5 Transcribe
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setErrorMsg("আপনার ব্রাউজারে মাইক্রোফোন ভয়েস ইনপুট সমর্থিত নয়।");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) {
          audioChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;

        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        audioChunksRef.current = [];
        if (blob.size === 0) {
          setVoiceMode("idle");
          return;
        }

        setVoiceMode("transcribing");
        try {
          const base64 = await blobToBase64(blob);
          const res = await apiRequest<{ text: string }>(
            "/api/admin/ai-assistant/transcribe",
            {
              method: "POST",
              body: JSON.stringify({
                audioBase64: base64,
                mimeType: blob.type || "audio/webm",
              }),
            }
          );
          if (res.text) {
            setInputText((prev) =>
              prev ? `${prev.trim()} ${res.text.trim()}` : res.text.trim()
            );
          }
        } catch (err) {
          setErrorMsg(
            err instanceof Error
              ? err.message
              : "ভয়েস রেকর্ড লেখা হিসেবে রূপান্তর করা যায়নি।"
          );
        } finally {
          setVoiceMode("idle");
        }
      };

      mediaRecorderRef.current = recorder;
      setVoiceMode("listening");
      recorder.start();
    } catch {
      setErrorMsg("মাইক্রোফোন অ্যাক্সেস পাওয়া যায়নি। ব্রাউজার অনুমতি পরীক্ষা করুন।");
      setVoiceMode("idle");
    }
  };

  const handleSendCommand = async (overrideText?: string) => {
    const prompt = (overrideText ?? inputText).trim();
    if (!prompt || isSending) return;
    setErrorMsg("");

    const userMsg: AiAssistantMessage = {
      id: `msg-u-${Date.now()}`,
      role: "user",
      text: prompt,
      timestamp: new Date().toISOString(),
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    if (!overrideText) setInputText("");
    setIsSending(true);

    try {
      const res = await apiRequest<{
        reply: string;
        actions: AiAssistantActionLog[];
        pendingProposals: AiAssistantPendingProposal[];
        snapshotId?: string;
        mutated: boolean;
        syncState?: AssistantSyncPayload;
      }>("/api/admin/ai-assistant/chat", {
        method: "POST",
        body: JSON.stringify({
          message: prompt,
          history: messages.slice(-10).map((m) => ({
            role: m.role,
            text: m.text,
          })),
        }),
      });

      const assistantMsg: AiAssistantMessage = {
        id: `msg-a-${Date.now()}`,
        role: "assistant",
        text: res.reply,
        timestamp: new Date().toISOString(),
        actions: res.actions || [],
        pendingProposals: res.pendingProposals || [],
        snapshotId: res.snapshotId,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      if (res.syncState) {
        if (res.syncState.aiAssistantConfig) {
          setConfig(res.syncState.aiAssistantConfig);
          setConfigDraft(res.syncState.aiAssistantConfig);
        }
        onSyncWorkspace(res.syncState);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "এআই অ্যাসিস্ট্যান্টের সাথে সংযোগ করতে সমস্যা হয়েছে।"
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleApplyProposals = async (msgId: string, proposals: AiAssistantPendingProposal[]) => {
    setErrorMsg("");
    setIsSending(true);
    try {
      const res = await apiRequest<{
        actions: AiAssistantActionLog[];
        snapshotId?: string;
        mutated: boolean;
        syncState?: AssistantSyncPayload;
      }>("/api/admin/ai-assistant/apply-proposals", {
        method: "POST",
        body: JSON.stringify({ proposals }),
      });

      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                proposalsResolved: "applied",
                actions: res.actions,
                snapshotId: res.snapshotId,
              }
            : m
        )
      );

      if (res.syncState) {
        if (res.syncState.aiAssistantConfig) {
          setConfig(res.syncState.aiAssistantConfig);
          setConfigDraft(res.syncState.aiAssistantConfig);
        }
        onSyncWorkspace(res.syncState);
      }
      flashNotice("প্রস্তাবিত পরিবর্তনসমূহ সফলভাবে প্রয়োগ করা হয়েছে।");
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "প্রস্তাবনা প্রয়োগ করা যায়নি।"
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleDismissProposals = (msgId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId ? { ...m, proposalsResolved: "dismissed" } : m
      )
    );
  };

  const handleUndoSnapshot = async (msgId: string, snapshotId: string) => {
    setErrorMsg("");
    try {
      const res = await apiRequest<{ ok: boolean; syncState: AssistantSyncPayload }>(
        `/api/admin/ai-assistant/undo/${encodeURIComponent(snapshotId)}`,
        { method: "POST" }
      );
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, undone: true } : m))
      );
      if (res.syncState) {
        if (res.syncState.aiAssistantConfig) {
          setConfig(res.syncState.aiAssistantConfig);
          setConfigDraft(res.syncState.aiAssistantConfig);
        }
        onSyncWorkspace(res.syncState);
      }
      flashNotice("পূর্বের অবস্থায় সফলভাবে ফিরিয়ে আনা হয়েছে।");
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "পূর্বাবস্থায় ফেরানো যায়নি।"
      );
    }
  };

  if (!pluginEnabled) {
    return (
      <div className="mt-6 bg-white border border-stone-200 rounded-xl p-8 text-center space-y-3">
        <p className="text-sm font-semibold text-stone-900">
          এআই অ্যাসিস্ট্যান্ট মডিউলটি বর্তমানে নিষ্ক্রিয় করা আছে
        </p>
        <p className="text-xs text-stone-600 max-w-lg mx-auto">
          প্লাগইন স্টুডিও থেকে “কাস্টমাইজযোগ্য অ্যাডমিন এআই অ্যাসিস্ট্যান্ট” প্লাগইনটি চালু করলে আপনি এখান থেকে কথা বলে সফটওয়্যারের সকল পরিবর্তন করতে পারবেন।
        </p>
        <button
          type="button"
          onClick={onOpenPluginStudio}
          className="h-10 px-4 rounded-lg bg-[#1E3A8A] text-xs font-semibold text-white hover:bg-[#172D6B] cursor-pointer"
        >
          প্লাগইন স্টুডিও খুলুন
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {notice && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800"
        >
          <Check className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-800"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT: CONVERSATIONAL COMMAND WORKSPACE */}
        <section
          aria-label="এআই অ্যাসিস্ট্যান্ট কথোপকথন"
          className="lg:col-span-8 bg-white border border-stone-200 rounded-xl flex flex-col overflow-hidden"
        >
          {/* Workspace Header */}
          <div className="px-5 py-4 border-b border-stone-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-[#1E3A8A]/10 text-[#1E3A8A] flex items-center justify-center shrink-0">
                <Bot className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-stone-900 truncate">
                  {config.assistantName}
                </h2>
                <p className="text-xs text-stone-500 truncate">
                  {config.autoApplyEdits
                    ? "সরাসরি পরিবর্তন প্রয়োগ সক্রিয় (তাৎক্ষণিক Undo-সহ)"
                    : "অনুমোদন সাপেক্ষ মোড (পরিবর্তনের আগে প্রস্তাবনা দেখাবে)"}
                </p>
              </div>
            </div>

            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setMessages([]);
                  try {
                    sessionStorage.removeItem("mdo_admin_ai_messages");
                  } catch {
                    // Ignore storage error
                  }
                }}
                className="h-9 px-3 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-700 hover:bg-stone-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                নতুন কথোপকথন
              </button>
            )}
          </div>

          {/* Conversation Stream */}
          <div className="p-5 space-y-4 min-h-[380px] max-h-[540px] overflow-y-auto bg-stone-50/50">
            {messages.length === 0 ? (
              <div className="py-6 space-y-4">
                <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-2.5">
                  <p className="text-sm font-semibold text-stone-900">
                    আসসালামু আলাইকুম! আমি আপনার অ্যাডমিন এআই অ্যাসিস্ট্যান্ট।
                  </p>
                  <p className="text-xs text-stone-600 leading-relaxed">
                    সফটওয়্যারের ছোটখাট পরিবর্তন থেকে শুরু করে ডিপ কাস্টমাইজেশন—সবকিছুই এখানে বাংলায় লিখে বা মাইক্রোফোনে কথা বলে নির্দেশ দিতে পারবেন:
                  </p>
                  <ul className="text-xs text-stone-700 space-y-1 pt-1 list-disc list-inside">
                    <li>ওয়েবসাইটের নাম, থিম রঙ, ফন্ট, ফুটার, মেনু শিরোনাম ও শীর্ষ নোটিশ পরিবর্তন</li>
                    <li>কাস্টম CSS দিয়ে ডিপ ডিজাইন, কার্ড স্টাইল, হেডার বা প্রিন্ট শিট কাস্টমাইজেশন</li>
                    <li>নতুন চিঠির টেমপ্লেট তৈরি, সংশোধন, বিভাগ যোগ/নাম বদল এবং দ্রুত বাক্য নিয়ন্ত্রণ</li>
                    <li>ইউজার অ্যাকাউন্ট তৈরি, পদবি/বিভাগ বদল এবং টেমপ্লেট অনুমতি ও প্লাগইন পরিচালনা</li>
                  </ul>
                </div>

                {(config.quickCommands || []).length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-stone-500">
                      দ্রুত পরীক্ষার নির্দেশনা (ক্লিক করে পাঠান):
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {config.quickCommands.map((cmd, idx) => (
                        <button
                          key={`${idx}-${cmd.slice(0, 12)}`}
                          type="button"
                          onClick={() => void handleSendCommand(cmd)}
                          disabled={isSending}
                          className="text-left px-3.5 py-2.5 rounded-lg border border-stone-200 bg-white text-xs text-stone-800 hover:border-[#1E3A8A]/40 hover:bg-[#1E3A8A]/5 transition-colors cursor-pointer"
                        >
                          {cmd}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.role === "user" ? "items-end" : "items-start"
                  }`}
                >
                  <div
                    className={`max-w-[92%] sm:max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-[#1E3A8A] text-white"
                        : "bg-white border border-stone-200 text-stone-800"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.text}</p>

                    {/* Executed Actions & Instant Undo */}
                    {msg.role === "assistant" &&
                      msg.actions &&
                      msg.actions.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-stone-200 space-y-2">
                          <p className="text-xs font-semibold text-stone-700">
                            কার্যকরকৃত পরিবর্তনসমূহ:
                          </p>
                          <ul className="space-y-1 text-xs text-stone-600">
                            {msg.actions.map((act, idx) => (
                              <li key={`${act.tool}-${idx}`}>
                                <span className="font-medium text-emerald-700">
                                  ✓ {act.labelBn}
                                </span>
                                <span aria-hidden="true"> · </span>
                                <span>{act.summary}</span>
                              </li>
                            ))}
                          </ul>

                          {msg.snapshotId && (
                            <div className="pt-1">
                              {msg.undone ? (
                                <span className="text-xs text-stone-500">
                                  পূর্বাবস্থায় ফিরিয়ে নেওয়া হয়েছে
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleUndoSnapshot(msg.id, msg.snapshotId!)
                                  }
                                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-stone-300 bg-stone-50 text-xs font-medium text-stone-700 hover:bg-stone-100 cursor-pointer"
                                >
                                  <Undo2 className="w-3.5 h-3.5" />
                                  <span>পূর্বাবস্থায় ফিরুন (Undo)</span>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                    {/* Pending Proposals in Confirmation Mode */}
                    {msg.role === "assistant" &&
                      msg.pendingProposals &&
                      msg.pendingProposals.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-stone-200 space-y-2.5">
                          <p className="text-xs font-semibold text-stone-800">
                            প্রস্তাবিত পরিবর্তন ({msg.pendingProposals.length}টি):
                          </p>
                          <ul className="space-y-1 text-xs text-stone-600">
                            {msg.pendingProposals.map((p) => (
                              <li key={p.id}>
                                • <span className="font-medium text-stone-800">{p.labelBn}</span>
                              </li>
                            ))}
                          </ul>

                          {msg.proposalsResolved === "applied" ? (
                            <p className="text-xs font-medium text-emerald-700">
                              ✓ প্রস্তাবনাসমূহ প্রয়োগ করা হয়েছে
                            </p>
                          ) : msg.proposalsResolved === "dismissed" ? (
                            <p className="text-xs text-stone-500">
                              প্রস্তাবনা বাতিল করা হয়েছে
                            </p>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <button
                                type="button"
                                disabled={isSending}
                                onClick={() =>
                                  void handleApplyProposals(
                                    msg.id,
                                    msg.pendingProposals!
                                  )
                                }
                                className="h-9 px-3.5 rounded-lg bg-[#1E3A8A] text-xs font-semibold text-white hover:bg-[#172D6B] disabled:opacity-60 cursor-pointer"
                              >
                                অনুমোদন ও প্রয়োগ করুন
                              </button>
                              <button
                                type="button"
                                disabled={isSending}
                                onClick={() => handleDismissProposals(msg.id)}
                                className="h-9 px-3 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-700 hover:bg-stone-50 cursor-pointer"
                              >
                                বাতিল
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                  </div>
                </div>
              ))
            )}

            {isSending && (
              <div className="flex items-start">
                <div className="bg-white border border-stone-200 rounded-xl px-4 py-3 text-xs text-stone-600">
                  আপনার নির্দেশনা বিশ্লেষণ ও কার্যকর করা হচ্ছে...
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Composer */}
          <div className="p-4 border-t border-stone-200 bg-white space-y-2.5">
            {voiceMode !== "idle" && (
              <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <span>
                  {voiceMode === "listening"
                    ? "মাইক্রোফোনে কথা বলুন — থামাতে মাইক বোতামে পুনরায় ক্লিক করুন"
                    : "আপনার ভয়েস নির্দেশনা বাংলা লেখায় রূপান্তর করা হচ্ছে..."}
                </span>
                {voiceMode === "listening" && (
                  <button
                    type="button"
                    onClick={stopVoiceCapture}
                    className="font-semibold underline cursor-pointer"
                  >
                    থামান
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
              <textarea
                id="admin-ai-prompt"
                name="adminAiPrompt"
                aria-label="এআই অ্যাসিস্ট্যান্ট নির্দেশনা"
                rows={2}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSendCommand();
                  }
                }}
                placeholder="যেকোনো ছোট বা ডিপ পরিবর্তনের নির্দেশ লিখুন বা মাইকে বলুন..."
                className="flex-1 rounded-lg border border-stone-300 px-3.5 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-[#1E3A8A] resize-none"
              />

              <div className="flex items-center gap-2 shrink-0">
                {config.enableVoiceInput && (
                  <button
                    type="button"
                    onClick={() => void handleToggleVoice()}
                    disabled={isSending || voiceMode === "transcribing"}
                    aria-label={
                      voiceMode === "listening"
                        ? "ভয়েস রেকর্ড বন্ধ করুন"
                        : "কথা বলে নির্দেশ দিন"
                    }
                    title="কথা বলে নির্দেশ দিন"
                    className={`inline-flex items-center justify-center gap-1.5 h-10 px-3.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      voiceMode === "listening"
                        ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
                        : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
                    }`}
                  >
                    {voiceMode === "listening" ? (
                      <>
                        <MicOff className="w-4 h-4" />
                        <span>থামান</span>
                      </>
                    ) : (
                      <>
                        <Mic className="w-4 h-4" />
                        <span>কথা বলুন</span>
                      </>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void handleSendCommand()}
                  disabled={isSending || !inputText.trim()}
                  className="inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-lg bg-[#1E3A8A] text-xs font-semibold text-white hover:bg-[#172D6B] disabled:opacity-50 whitespace-nowrap cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isSending ? "চলছে..." : "প্রয়োগ করুন"}</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* RIGHT: ASSISTANT CUSTOMIZATION SETTINGS */}
        <form
          onSubmit={handleSaveConfig}
          className="lg:col-span-4 bg-white border border-stone-200 rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-stone-200">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-[#1E3A8A]" />
              <h2 className="text-sm font-semibold text-stone-900">
                অ্যাসিস্ট্যান্ট কাস্টমাইজেশন
              </h2>
            </div>
            <button
              type="button"
              onClick={() => void handleResetConfig()}
              disabled={savingConfig || loadingConfig}
              title="ডিফল্ট সেটিংস"
              className="inline-flex items-center gap-1 text-xs text-stone-600 hover:text-stone-900 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>ডিফল্ট</span>
            </button>
          </div>

          {loadingConfig ? (
            <p className="text-xs text-stone-500 py-4">সেটিংস লোড হচ্ছে...</p>
          ) : (
            <>
              <div>
                <label
                  htmlFor="ai-cfg-name"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  অ্যাসিস্ট্যান্টের নাম
                </label>
                <input
                  id="ai-cfg-name"
                  type="text"
                  value={configDraft.assistantName}
                  onChange={(e) =>
                    setConfigDraft({ ...configDraft, assistantName: e.target.value })
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                />
              </div>

              <div>
                <label
                  htmlFor="ai-cfg-role"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  ভূমিকা / পরিচয় (Persona)
                </label>
                <input
                  id="ai-cfg-role"
                  type="text"
                  value={configDraft.personaRole}
                  onChange={(e) =>
                    setConfigDraft({ ...configDraft, personaRole: e.target.value })
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                />
              </div>

              <div>
                <label
                  htmlFor="ai-cfg-tone"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  উত্তর ও কাজের সুর
                </label>
                <input
                  id="ai-cfg-tone"
                  type="text"
                  value={configDraft.preferredTone}
                  onChange={(e) =>
                    setConfigDraft({ ...configDraft, preferredTone: e.target.value })
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                />
              </div>

              <div>
                <label
                  htmlFor="ai-cfg-reasoning"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  যুক্তি ও বিশ্লেষণ স্তর
                </label>
                <select
                  id="ai-cfg-reasoning"
                  value={configDraft.reasoningDepth || "deep"}
                  onChange={(e) =>
                    setConfigDraft({
                      ...configDraft,
                      reasoningDepth:
                        e.target.value === "balanced" ? "balanced" : "deep",
                    })
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 bg-white px-3 text-xs text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                >
                  <option value="deep">
                    সর্বোচ্চ গভীর ও সিনিয়র ইঞ্জিনিয়ার স্তর (গভীর বিশ্লেষণ)
                  </option>
                  <option value="balanced">দ্রুত ও ভারসাম্যপূর্ণ</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="ai-cfg-instructions"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  কাস্টম নির্দেশনা ও নিয়মাবলি (System Prompt)
                </label>
                <textarea
                  id="ai-cfg-instructions"
                  rows={4}
                  value={configDraft.customInstructions}
                  onChange={(e) =>
                    setConfigDraft({
                      ...configDraft,
                      customInstructions: e.target.value,
                    })
                  }
                  placeholder="এআই কীভাবে কাজ করবে, কোন স্টাইল অনুসরণ করবে তা লিখে দিন..."
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-xs text-stone-900 leading-relaxed focus:outline-none focus:border-[#1E3A8A]"
                />
              </div>

              <div className="space-y-2.5 pt-1">
                <label
                  htmlFor="ai-cfg-auto-apply"
                  className="flex items-start gap-2.5 text-xs text-stone-800 cursor-pointer"
                >
                  <input
                    id="ai-cfg-auto-apply"
                    type="checkbox"
                    checked={configDraft.autoApplyEdits}
                    onChange={(e) =>
                      setConfigDraft({
                        ...configDraft,
                        autoApplyEdits: e.target.checked,
                      })
                    }
                    className="mt-0.5 w-4 h-4 accent-[#1E3A8A] shrink-0"
                  />
                  <span>
                    <span className="font-semibold block">
                      সরাসরি পরিবর্তন প্রয়োগ করুন
                    </span>
                    <span className="text-[11px] text-stone-500">
                      চালু থাকলে সাথে সাথে পরিবর্তন কার্যকর হবে (১-ক্লিকে Undo করা যাবে); বন্ধ থাকলে আগে অনুমোদন চাইবে।
                    </span>
                  </span>
                </label>

                <label
                  htmlFor="ai-cfg-voice"
                  className="flex items-center gap-2.5 text-xs text-stone-800 cursor-pointer"
                >
                  <input
                    id="ai-cfg-voice"
                    type="checkbox"
                    checked={configDraft.enableVoiceInput}
                    onChange={(e) =>
                      setConfigDraft({
                        ...configDraft,
                        enableVoiceInput: e.target.checked,
                      })
                    }
                    className="w-4 h-4 accent-[#1E3A8A] shrink-0"
                  />
                  <span className="font-medium">
                    ভয়েস (কথা বলে কমান্ড) সুবিধা চালু রাখুন
                  </span>
                </label>
              </div>

              {/* Customizable Quick Commands */}
              <div className="pt-2 border-t border-stone-200 space-y-2">
                <p className="text-xs font-medium text-stone-700">
                  কুইক কমান্ড শর্টকাটসমূহ
                </p>
                <div className="flex gap-1.5">
                  <input
                    id="ai-new-quick-cmd"
                    type="text"
                    value={newQuickCmd}
                    onChange={(e) => setNewQuickCmd(e.target.value)}
                    placeholder="নতুন শর্টকাট কমান্ড..."
                    className="flex-1 h-9 rounded-lg border border-stone-300 px-2.5 text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleAddQuickCmd}
                    aria-label="শর্টকাট যোগ করুন"
                    className="h-9 px-2.5 rounded-lg border border-stone-300 bg-stone-50 text-stone-700 hover:bg-stone-100 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                {(configDraft.quickCommands || []).length > 0 && (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {configDraft.quickCommands.map((cmd, idx) => (
                      <div
                        key={`${idx}-${cmd.slice(0, 10)}`}
                        className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-stone-50 border border-stone-200 text-[11px] text-stone-700"
                      >
                        <span className="truncate">{cmd}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveQuickCmd(idx)}
                          aria-label="শর্টকাট সরান"
                          className="text-stone-400 hover:text-red-700 shrink-0 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={savingConfig}
                className="w-full h-10 rounded-lg bg-[#1E3A8A] text-xs font-semibold text-white hover:bg-[#172D6B] disabled:opacity-60 cursor-pointer"
              >
                {savingConfig
                  ? "সংরক্ষণ হচ্ছে..."
                  : "অ্যাসিস্ট্যান্ট সেটিংস সংরক্ষণ করুন"}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
};
