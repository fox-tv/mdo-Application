import React, { useEffect, useRef, useState } from "react";
import {
  Check,
  Cloud,
  Copy,
  ExternalLink,
  FileDown,
  FileSpreadsheet,
  History,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  Wand2,
  PenLine,
  AlertCircle,
  X,
} from "lucide-react";
import {
  DepartmentItem,
  LetterData,
  LetterFont,
  LetterheadStyle,
  LetterTemplate,
  OfficeFontMode,
  OrganizationProfile,
  QuickPhrase,
  SitePlugin,
} from "../types";
import { apiRequest } from "../utils/api";
import {
  formatBanglaCalendarDate,
  formatBengaliDate,
  formatBengaliTime,
  generateNextRefNumber,
  toBengaliDigits,
} from "../utils/bengali";
import {
  getBranchPadMap,
  isBranchPadPluginEnabled,
  resolveBranchPadForLetter,
} from "../utils/branchPad";
import {
  createPrintableHtmlUrl,
  exportLetterToExcel,
  exportLetterToPdf,
  exportLetterToWord,
} from "../utils/export";
import { LetterPreview } from "./LetterPreview";

interface EditorViewProps {
  letter: LetterData;
  org: OrganizationProfile;
  templates: LetterTemplate[];
  departments: DepartmentItem[];
  quickPhrases: QuickPhrase[];
  plugins?: SitePlugin[];
  userDepartment?: string;
  pluginSnippets?: { id: string; name: string; text: string }[];
  allowAiDrafting: boolean;
  isSavedOnServer?: boolean;
  initialNeedsSync?: boolean;
  onChange: (updated: LetterData) => void;
  onSaveLetter: (
    letter: LetterData,
    options?: { keepalive?: boolean }
  ) => Promise<void> | void;
  onDraftSynced?: () => void;
  onApplyTemplate: (templateId: string) => void;
}

type AutoSaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

type EditorSubTab = "content" | "recipient" | "design" | "history";

interface LetterRevision {
  id: string;
  timestamp: string;
  summary: string;
  changedFields: string[];
  isSavedPoint?: boolean;
  snapshot: LetterData;
}

const TRACKED_FIELD_LABELS: { key: keyof LetterData; label: string }[] = [
  { key: "subject", label: "বিষয়" },
  { key: "salutation", label: "সম্বোধন" },
  { key: "body", label: "মূল বক্তব্য" },
  { key: "closing", label: "সমাপ্তি সম্ভাষণ" },
  { key: "recipientPrefix", label: "প্রাপক উপসর্গ" },
  { key: "recipientName", label: "প্রাপকের নাম" },
  { key: "recipientTitle", label: "প্রাপকের পদবি" },
  { key: "recipientOrg", label: "প্রাপকের প্রতিষ্ঠান" },
  { key: "recipientAddress", label: "প্রাপকের ঠিকানা" },
  { key: "refNumber", label: "স্মারক নম্বর" },
  { key: "dateText", label: "তারিখ" },
  { key: "showBanglaDate", label: "বঙ্গাব্দ তারিখ" },
  { key: "banglaDateText", label: "বাংলা তারিখ" },
  { key: "templateType", label: "পত্রের ধরন" },
  { key: "attachments", label: "সংযুক্তি" },
  { key: "ccList", label: "অনুলিপি" },
  { key: "signatoryName", label: "স্বাক্ষরকারীর নাম" },
  { key: "signatoryTitle", label: "স্বাক্ষরকারীর পদবি" },
  { key: "signatoryDept", label: "স্বাক্ষরকারীর শাখা" },
  { key: "letterheadStyle", label: "প্যাডের শৈলী" },
  { key: "letterFont", label: "মুদ্রণ ফন্ট" },
  { key: "showWatermark", label: "প্রতীক ও লোগো" },
  { key: "showSealPlaceholder", label: "সীলমোহর বক্স" },
  { key: "branchPadDepartment", label: "শাখার প্যাড" },
];

function diffLetterFields(prev: LetterData, next: LetterData): string[] {
  const changed: string[] = [];
  for (const field of TRACKED_FIELD_LABELS) {
    if (prev[field.key] !== next[field.key]) {
      changed.push(field.label);
    }
  }
  return changed;
}

function summarizeChanges(changedFields: string[]): string {
  if (changedFields.length === 0) return "খসড়া হালনাগাদ";
  if (changedFields.length === 1) return `${changedFields[0]} সংশোধন`;
  if (changedFields.length === 2) {
    return `${changedFields[0]} ও ${changedFields[1]} সংশোধন`;
  }
  return `${changedFields[0]}, ${changedFields[1]}সহ ${toBengaliDigits(changedFields.length)}টি ক্ষেত্র সংশোধন`;
}

const TONE_OPTIONS = [
  "অতি আনুষ্ঠানিক ও দাপ্তরিক",
  "সৌজন্যমূলক ও আন্তরিক",
  "জরুরি ও নির্দেশমূলক",
  "সংক্ষিপ্ত ও সুস্পষ্ট",
];

export const EditorView: React.FC<EditorViewProps> = ({
  letter,
  org,
  templates,
  departments,
  quickPhrases,
  plugins = [],
  userDepartment,
  pluginSnippets = [],
  allowAiDrafting,
  isSavedOnServer = false,
  initialNeedsSync = false,
  onChange,
  onSaveLetter,
  onDraftSynced,
  onApplyTemplate,
}) => {
  const [subTab, setSubTab] = useState<EditorSubTab>("content");
  const [aiPrompt, setAiPrompt] = useState("");
  const [tone, setTone] = useState(TONE_OPTIONS[0]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiError, setAiError] = useState("");
  const [zoom, setZoom] = useState<0.7 | 0.85 | 1>(0.85);
  const [fitScale, setFitScale] = useState(1);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [exportError, setExportError] = useState("");
  const [printFallbackUrl, setPrintFallbackUrl] = useState("");
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [officeFontMode, setOfficeFontMode] = useState<OfficeFontMode>("bijoy");
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>(() =>
    initialNeedsSync ? "pending" : isSavedOnServer ? "saved" : "idle"
  );
  const [lastAutoSavedTime, setLastAutoSavedTime] = useState<string>(() =>
    isSavedOnServer && !initialNeedsSync ? formatBengaliTime() : ""
  );

  // Local pre-save revision history state
  const [revisions, setRevisions] = useState<LetterRevision[]>(() => [
    {
      id: `rev-init-${Date.now()}`,
      timestamp: formatBengaliTime(),
      summary: "প্রাথমিক খসড়া",
      changedFields: [],
      snapshot: { ...letter },
    },
  ]);

  const exportRef = useRef<HTMLDivElement | null>(null);
  const activeLetterIdRef = useRef<string>(letter.id);
  const letterRef = useRef<LetterData>(letter);
  letterRef.current = letter;
  const lastRecordedSnapshotRef = useRef<LetterData>({ ...letter });
  const lastServerSnapshotRef = useRef<LetterData>({ ...letter });
  const pendingInitialSyncRef = useRef<boolean>(initialNeedsSync);
  const revisionTimerRef = useRef<number | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const saveSeqRef = useRef<number>(0);
  const skipNextAutoTrackRef = useRef<boolean>(false);
  const onSaveLetterRef = useRef(onSaveLetter);
  const onDraftSyncedRef = useRef(onDraftSynced);
  onSaveLetterRef.current = onSaveLetter;
  onDraftSyncedRef.current = onDraftSynced;

  useEffect(() => {
    return () => {
      if (printFallbackUrl) {
        URL.revokeObjectURL(printFallbackUrl);
      }
    };
  }, [printFallbackUrl]);

  const executeAutoSave = async (
    targetSnapshot: LetterData,
    options?: { keepalive?: boolean }
  ) => {
    const seq = ++saveSeqRef.current;
    setAutoSaveStatus("saving");
    try {
      await onSaveLetterRef.current(targetSnapshot, options);
      if (activeLetterIdRef.current !== targetSnapshot.id) return;
      lastServerSnapshotRef.current = { ...targetSnapshot };
      pendingInitialSyncRef.current = false;
      onDraftSyncedRef.current?.();
      const stillDirty =
        diffLetterFields(targetSnapshot, letterRef.current).length > 0;
      if (stillDirty) {
        setAutoSaveStatus("pending");
      } else if (seq === saveSeqRef.current) {
        setAutoSaveStatus("saved");
        setLastAutoSavedTime(formatBengaliTime());
      }
    } catch {
      if (activeLetterIdRef.current === targetSnapshot.id) {
        setAutoSaveStatus("error");
      }
    }
  };

  // Reset local revision history & auto-save baseline when switching to a different letter/template
  useEffect(() => {
    if (activeLetterIdRef.current !== letter.id) {
      if (revisionTimerRef.current) {
        window.clearTimeout(revisionTimerRef.current);
        revisionTimerRef.current = null;
      }
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      activeLetterIdRef.current = letter.id;
      lastRecordedSnapshotRef.current = { ...letter };
      lastServerSnapshotRef.current = { ...letter };
      pendingInitialSyncRef.current = initialNeedsSync;
      setAutoSaveStatus(
        initialNeedsSync ? "pending" : isSavedOnServer ? "saved" : "idle"
      );
      setLastAutoSavedTime(
        isSavedOnServer && !initialNeedsSync ? formatBengaliTime() : ""
      );
      setRevisions([
        {
          id: `rev-init-${Date.now()}`,
          timestamp: formatBengaliTime(),
          summary: "প্রাথমিক খসড়া",
          changedFields: [],
          snapshot: { ...letter },
        },
      ]);
    }
  }, [letter, isSavedOnServer, initialNeedsSync]);

  // Real-time Auto-Save: sync restored dirty draft or debounced live edits to server
  useEffect(() => {
    if (activeLetterIdRef.current !== letter.id) return;

    const unsynced = diffLetterFields(lastServerSnapshotRef.current, letter);
    const shouldSync = unsynced.length > 0 || pendingInitialSyncRef.current;
    if (!shouldSync) return;

    setAutoSaveStatus((prev) => (prev === "saving" ? "saving" : "pending"));
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
    }

    const snapshotCopy: LetterData = { ...letter };
    const delayMs = pendingInitialSyncRef.current && unsynced.length === 0 ? 250 : 750;
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      void executeAutoSave(snapshotCopy);
    }, delayMs);

    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [letter]);

  // Flush any pending unsaved changes on browser reload / tab close / component unmount
  useEffect(() => {
    const flushPending = () => {
      const current = letterRef.current;
      const unsynced = diffLetterFields(lastServerSnapshotRef.current, current);
      if (unsynced.length > 0 || pendingInitialSyncRef.current) {
        void onSaveLetterRef.current(current, { keepalive: true });
      }
    };
    const handleUnload = () => {
      flushPending();
    };
    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("pagehide", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("pagehide", handleUnload);
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      flushPending();
    };
  }, []);

  // Debounced tracking of small local edits before user hits Save
  useEffect(() => {
    if (activeLetterIdRef.current !== letter.id) return;
    if (skipNextAutoTrackRef.current) {
      skipNextAutoTrackRef.current = false;
      return;
    }

    const changed = diffLetterFields(lastRecordedSnapshotRef.current, letter);
    if (changed.length === 0) return;

    if (revisionTimerRef.current) {
      window.clearTimeout(revisionTimerRef.current);
    }

    const snapshotCopy: LetterData = { ...letter };
    revisionTimerRef.current = window.setTimeout(() => {
      const latestChanged = diffLetterFields(
        lastRecordedSnapshotRef.current,
        snapshotCopy
      );
      if (latestChanged.length === 0) return;

      lastRecordedSnapshotRef.current = snapshotCopy;
      setRevisions((prev) => [
        {
          id: `rev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: formatBengaliTime(),
          summary: summarizeChanges(latestChanged),
          changedFields: latestChanged,
          snapshot: snapshotCopy,
        },
        ...prev.slice(0, 39),
      ]);
      revisionTimerRef.current = null;
    }, 700);

    return () => {
      if (revisionTimerRef.current) {
        window.clearTimeout(revisionTimerRef.current);
        revisionTimerRef.current = null;
      }
    };
  }, [letter]);

  const recordInstantRevision = (
    nextSnapshot: LetterData,
    customSummary?: string,
    isSavedPoint = false
  ) => {
    if (revisionTimerRef.current) {
      window.clearTimeout(revisionTimerRef.current);
      revisionTimerRef.current = null;
    }
    const changed = diffLetterFields(lastRecordedSnapshotRef.current, nextSnapshot);
    if (changed.length === 0 && !isSavedPoint) return;

    lastRecordedSnapshotRef.current = { ...nextSnapshot };
    setRevisions((prev) => [
      {
        id: `rev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: formatBengaliTime(),
        summary: customSummary || summarizeChanges(changed),
        changedFields: changed,
        isSavedPoint,
        snapshot: { ...nextSnapshot },
      },
      ...prev.slice(0, 39),
    ]);
  };

  const handleRestoreRevision = (rev: LetterRevision) => {
    const restored: LetterData = { ...rev.snapshot, id: letter.id };
    skipNextAutoTrackRef.current = true;
    recordInstantRevision(
      restored,
      `সংস্করণ পুনরুদ্ধার (${rev.timestamp})`
    );
    onChange(restored);
  };

  const handleClearRevisions = () => {
    if (revisionTimerRef.current) {
      window.clearTimeout(revisionTimerRef.current);
      revisionTimerRef.current = null;
    }
    lastRecordedSnapshotRef.current = { ...letter };
    setRevisions([
      {
        id: `rev-reset-${Date.now()}`,
        timestamp: formatBengaliTime(),
        summary: "বর্তমান খসড়া (ভিত্তি সংস্করণ)",
        changedFields: [],
        snapshot: { ...letter },
      },
    ]);
  };

  const updateField = <K extends keyof LetterData>(key: K, value: LetterData[K]) => {
    onChange({ ...letter, [key]: value });
  };

  const handleAiAction = async (mode: "generate" | "polish") => {
    setAiError("");
    if (mode === "generate" && !aiPrompt.trim()) {
      setAiError("অনুগ্রহ করে কী বিষয়ে চিঠি লিখতে চান তা সংক্ষেপে লিখুন।");
      return;
    }
    if (mode === "polish" && !letter.body.trim()) {
      setAiError("পরিমার্জন করার জন্য আগে চিঠির মূল বক্তব্য লিখুন।");
      return;
    }

    setIsGenerating(true);
    try {
      const recipientSummary = [
        letter.recipientName,
        letter.recipientTitle,
        letter.recipientOrg,
        letter.recipientAddress,
      ]
        .filter(Boolean)
        .join(", ");

      const data = await apiRequest<{
        subject?: string;
        salutation?: string;
        body?: string;
        closing?: string;
        attachments?: string;
        refCodeSuffix?: string;
      }>("/api/generate-letter", {
        method: "POST",
        body: JSON.stringify({
          mode,
          prompt: aiPrompt,
          templateType: letter.templateType,
          tone,
          organizationName: org.nameBn,
          organizationType: org.tagline,
          recipientInfo: recipientSummary,
          currentSubject: letter.subject,
          currentBody: letter.body,
        }),
      });

      const nextRef =
        mode === "generate" && data.refCodeSuffix
          ? generateNextRefNumber(org.refPrefix, data.refCodeSuffix)
          : letter.refNumber;

      onChange({
        ...letter,
        subject: data.subject ?? letter.subject,
        salutation: data.salutation ?? letter.salutation,
        body: data.body ?? letter.body,
        closing: data.closing ?? letter.closing,
        attachments:
          typeof data.attachments === "string" && data.attachments.trim()
            ? data.attachments
            : letter.attachments,
        refNumber: nextRef,
      });
    } catch (err: unknown) {
      setAiError(
        err instanceof Error
          ? err.message
          : "সার্ভারের সাথে সংযোগ করতে সমস্যা হয়েছে।"
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyText = async () => {
    const plainText = [
      org.nameBn,
      org.address,
      "",
      `স্মারক নং: ${letter.refNumber}`,
      `তারিখ: ${letter.dateText}${letter.showBanglaDate ? ` (${letter.banglaDateText})` : ""}`,
      "",
      letter.recipientPrefix ? `${letter.recipientPrefix},` : "",
      letter.recipientName,
      letter.recipientTitle,
      letter.recipientOrg,
      letter.recipientAddress,
      "",
      `বিষয়: ${letter.subject}`,
      "",
      letter.salutation,
      letter.body,
      "",
      letter.closing,
      letter.signatoryName,
      letter.signatoryTitle,
      letter.signatoryDept,
      letter.attachments ? `\nসংযুক্তি:\n${letter.attachments}` : "",
      letter.ccList ? `\nঅনুলিপি:\n${letter.ccList}` : "",
    ]
      .filter((line) => line !== undefined && line !== null)
      .join("\n");

    try {
      await navigator.clipboard.writeText(plainText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleSave = async () => {
    setExportError("");
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    setIsSaving(true);
    setAutoSaveStatus("saving");
    const seq = ++saveSeqRef.current;
    try {
      // Flush any pending unsaved local edits before recording save checkpoint
      const pendingChanged = diffLetterFields(lastRecordedSnapshotRef.current, letter);
      if (pendingChanged.length > 0) {
        recordInstantRevision(letter);
      }
      await onSaveLetter(letter);
      lastServerSnapshotRef.current = { ...letter };
      pendingInitialSyncRef.current = false;
      onDraftSynced?.();
      if (seq === saveSeqRef.current) {
        setAutoSaveStatus("saved");
        setLastAutoSavedTime(formatBengaliTime());
      }
      skipNextAutoTrackRef.current = true;
      recordInstantRevision(letter, "সার্ভারে স্থায়ীভাবে সংরক্ষিত", true);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2200);
    } catch (err: unknown) {
      setAutoSaveStatus("error");
      setExportError(
        err instanceof Error ? err.message : "পত্র সংরক্ষণ করা যায়নি।"
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handlePrint = async () => {
    setExportError("");
    const startTime = performance.now();
    try {
      window.print();
    } catch {
      // Blocked by sandboxed iframe
    }
    const elapsed = performance.now() - startTime;
    const inIframe = window.self !== window.top;

    if (inIframe && elapsed < 120) {
      try {
        if (printFallbackUrl) {
          URL.revokeObjectURL(printFallbackUrl);
        }
        const url = await createPrintableHtmlUrl(
          exportRef.current,
          letter.subject || letter.refNumber || "দাপ্তরিক চিঠি"
        );
        setPrintFallbackUrl(url);
        setShowPrintDialog(true);
      } catch {
        setExportError(
          "প্রিন্ট ভিউ প্রস্তুত করা যায়নি। অনুগ্রহ করে পিডিএফ ডাউনলোড ব্যবহার করুন।"
        );
      }
    }
  };

  const handlePdfDownload = async () => {
    setExportError("");
    setIsExportingPdf(true);
    try {
      await exportLetterToPdf(
        exportRef.current,
        letter.subject || letter.refNumber || "bangla_letter"
      );
    } catch (err: unknown) {
      setExportError(
        err instanceof Error
          ? err.message
          : "পিডিএফ তৈরি করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।"
      );
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleWordExport = () => {
    void exportLetterToWord(
      exportRef.current,
      letter.subject || letter.refNumber || "bangla_letter",
      officeFontMode
    );
  };

  const handleExcelExport = () => {
    exportLetterToExcel(
      letter,
      org,
      letter.subject || letter.refNumber || "bangla_letter",
      officeFontMode
    );
  };

  const appendPhrase = (phrase: string) => {
    const trimmed = letter.body.trim();
    const next = trimmed ? `${trimmed}\n\n${phrase} ` : `${phrase} `;
    updateField("body", next);
  };

  const departmentNames = departments.map((d) => d.name);
  const uncategorizedTemplates = templates.filter(
    (t) => !departmentNames.includes(t.category)
  );
  const branchPadEnabled = isBranchPadPluginEnabled(plugins);
  const branchPadMap = getBranchPadMap(plugins);
  const configuredBranchPadNames = Object.keys(branchPadMap).filter(
    (dept) => branchPadMap[dept]?.enabled !== false
  );
  const activeBranchPad = resolveBranchPadForLetter({
    plugins,
    letter,
    templates,
    userDepartment,
  });

  return (
    <div className="print-reset-container max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="print-reset-container grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: EDITOR & AI COMPOSER */}
        <section
          data-section="editor-controls"
          aria-label="চিঠি সম্পাদনা প্যানেল"
          className="no-print lg:col-span-5 bg-white border border-stone-200 rounded-xl overflow-hidden"
        >
          {/* Real-Time Auto-Save Indicator Bar */}
          <div
            data-testid="autosave-indicator"
            role="status"
            aria-live="polite"
            className="px-5 py-2.5 bg-stone-50/90 border-b border-stone-200 flex items-center justify-between gap-2 text-xs"
          >
            <div className="flex items-center gap-2 min-w-0">
              {autoSaveStatus === "saving" && (
                <>
                  <RefreshCw className="w-3.5 h-3.5 text-[#1E3A8A] animate-spin shrink-0" />
                  <span className="font-medium text-stone-800 truncate">
                    Auto-Save: অটো-সেভ হচ্ছে...
                  </span>
                </>
              )}
              {autoSaveStatus === "pending" && (
                <>
                  <Cloud className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span className="font-medium text-amber-800 truncate">
                    Auto-Save: ব্রাউজারে সেভড · সার্ভারে সিঙ্ক হচ্ছে...
                  </span>
                </>
              )}
              {autoSaveStatus === "saved" && (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                  <span className="font-medium text-emerald-800 truncate">
                    Auto-Save: স্বয়ংক্রিয়ভাবে সংরক্ষিত
                    {lastAutoSavedTime ? ` · ${lastAutoSavedTime}` : ""}
                  </span>
                </>
              )}
              {autoSaveStatus === "idle" && (
                <>
                  <Cloud className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                  <span className="font-medium text-stone-700 truncate">
                    Auto-Save চালু · প্রতিটি পরিবর্তন রিয়েল-টাইমে সংরক্ষিত হয়
                  </span>
                </>
              )}
              {autoSaveStatus === "error" && (
                <>
                  <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                  <span className="font-medium text-red-700 truncate">
                    Auto-Save: ব্রাউজারে খসড়া সুরক্ষিত · সার্ভারে সিঙ্ক ব্যর্থ
                  </span>
                </>
              )}
            </div>

            {autoSaveStatus === "error" ? (
              <button
                type="button"
                onClick={() => void executeAutoSave({ ...letter })}
                className="shrink-0 text-[11px] font-semibold text-[#1E3A8A] hover:underline cursor-pointer"
              >
                পুনরায় চেষ্টা
              </button>
            ) : (
              <span className="shrink-0 text-[11px] text-stone-500 whitespace-nowrap">
                রিলোড-নিরাপদ
              </span>
            )}
          </div>

          {/* AI Drafting Box */}
          {allowAiDrafting ? (
            <div className="p-5 bg-[#FAF9F6] border-b border-stone-200">
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <h2 className="text-sm font-semibold text-stone-900">
                  এআই সহায়তায় দাপ্তরিক পত্র রচনা
                </h2>
                <span className="text-xs text-stone-500">শুদ্ধ বাংলা বা বাংলিশে লিখুন</span>
              </div>

              <textarea
                id="editor-ai-prompt"
                name="aiPrompt"
                aria-label="এআই সহায়তায় চিঠির নির্দেশনা"
                rows={3}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="উদাহরণ: জাগরণ ঋণ প্রোডাক্টে এক সদস্যের আগাম ঋণ পরিশোধে ১,৫০০ টাকা রিবেট অনুমোদন ও প্রাপ্তি স্বীকারপত্র তৈরি করে দাও..."
                className="w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/25 focus:border-[#1E3A8A] resize-none"
              />

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5">
                <select
                  id="editor-ai-tone"
                  name="aiTone"
                  aria-label="পত্রের ভাষা ও সুর"
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="h-10 rounded-lg border border-stone-300 bg-white px-3 text-xs font-medium text-stone-700 focus:outline-none focus:border-[#1E3A8A]"
                >
                  {TONE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      সুর: {opt}
                    </option>
                  ))}
                </select>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleAiAction("polish")}
                    disabled={isGenerating}
                    className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <PenLine className="w-3.5 h-3.5" />
                    <span>ভাষা পরিমার্জন</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAiAction("generate")}
                    disabled={isGenerating}
                    className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-[#1E3A8A] text-xs font-medium text-white hover:bg-[#172D6B] disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    <span>{isGenerating ? "প্রস্তুত হচ্ছে..." : "খসড়া প্রস্তুত করুন"}</span>
                  </button>
                </div>
              </div>

              {aiError && (
                <div
                  role="alert"
                  className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                  <span>{aiError}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="px-5 py-3 bg-stone-50 border-b border-stone-200 text-xs text-stone-500">
              অ্যাডমিন কর্তৃক এআই চিঠি রচনা সুবিধা বর্তমানে বন্ধ রাখা হয়েছে। নিচের টেমপ্লেট ও সম্পাদক ব্যবহার করুন।
            </div>
          )}

          {/* Sub-tabs inside Editor */}
          <div className="px-5 pt-3 pb-2 border-b border-stone-200 bg-white">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 bg-stone-100 rounded-lg">
              <button
                type="button"
                onClick={() => setSubTab("content")}
                className={`py-2 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  subTab === "content"
                    ? "bg-white text-stone-900 shadow-xs"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                বিষয় ও বক্তব্য
              </button>
              <button
                type="button"
                onClick={() => setSubTab("recipient")}
                className={`py-2 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  subTab === "recipient"
                    ? "bg-white text-stone-900 shadow-xs"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                প্রাপক ও স্মারক
              </button>
              <button
                type="button"
                onClick={() => setSubTab("design")}
                className={`py-2 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  subTab === "design"
                    ? "bg-white text-stone-900 shadow-xs"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                স্বাক্ষর ও নকশা
              </button>
              <button
                type="button"
                onClick={() => setSubTab("history")}
                className={`py-2 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer tabular-nums ${
                  subTab === "history"
                    ? "bg-white text-stone-900 shadow-xs"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                ইতিহাস ({toBengaliDigits(revisions.length)})
              </button>
            </div>
          </div>

          {/* Form Fields */}
          <div className="p-5 space-y-4">
            {subTab === "content" && (
              <>
                <div>
                  <label
                    htmlFor="editor-template-select"
                    className="block text-xs font-medium text-stone-700 mb-1.5"
                  >
                    প্রস্তুত টেমপ্লেট থেকে বদলান
                  </label>
                  <select
                    id="editor-template-select"
                    name="templateSelect"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) onApplyTemplate(e.target.value);
                    }}
                    className="w-full h-10 rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-800 focus:outline-none focus:border-[#1E3A8A]"
                  >
                    <option value="">টেমপ্লেট নির্বাচন করুন (বিভাগ অনুযায়ী)...</option>
                    {departments.map((dept) => {
                      const deptTemplates = templates.filter(
                        (t) => t.category === dept.name
                      );
                      if (deptTemplates.length === 0) return null;
                      return (
                        <optgroup key={dept.id} label={dept.name}>
                          {deptTemplates.map((tpl) => (
                            <option key={tpl.id} value={tpl.id}>
                              {tpl.title}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                    {uncategorizedTemplates.length > 0 && (
                      <optgroup label="অন্যান্য">
                        {uncategorizedTemplates.map((tpl) => (
                          <option key={tpl.id} value={tpl.id}>
                            {tpl.title}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="editor-subject"
                    className="block text-xs font-medium text-stone-700 mb-1.5"
                  >
                    চিঠির বিষয়
                  </label>
                  <input
                    id="editor-subject"
                    name="subject"
                    type="text"
                    value={letter.subject}
                    onChange={(e) => updateField("subject", e.target.value)}
                    placeholder="যেমন: বার্ষিক সাধারণ সভা প্রসঙ্গে।"
                    className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="editor-salutation"
                      className="block text-xs font-medium text-stone-700 mb-1.5"
                    >
                      সম্বোধন
                    </label>
                    <input
                      id="editor-salutation"
                      name="salutation"
                      type="text"
                      value={letter.salutation}
                      onChange={(e) => updateField("salutation", e.target.value)}
                      placeholder="মহোদয়,"
                      className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="editor-closing"
                      className="block text-xs font-medium text-stone-700 mb-1.5"
                    >
                      সমাপ্তি সম্ভাষণ
                    </label>
                    <input
                      id="editor-closing"
                      name="closing"
                      type="text"
                      value={letter.closing}
                      onChange={(e) => updateField("closing", e.target.value)}
                      placeholder="বিনীত,"
                      className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="editor-body"
                      className="text-xs font-medium text-stone-700"
                    >
                      মূল বক্তব্য
                    </label>
                    <span className="text-[11px] text-stone-400">
                      নতুন প্যারার জন্য দুইবার Enter দিন
                    </span>
                  </div>
                  <textarea
                    id="editor-body"
                    name="body"
                    rows={10}
                    value={letter.body}
                    onChange={(e) => updateField("body", e.target.value)}
                    placeholder="চিঠির মূল বক্তব্য লিখুন..."
                    className="w-full rounded-lg border border-stone-300 px-3.5 py-2.5 text-sm leading-relaxed text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                  />
                  {(quickPhrases.length > 0 || pluginSnippets.length > 0) && (
                    <div className="mt-2 space-y-2">
                      {quickPhrases.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {quickPhrases.map((phrase) => (
                            <button
                              key={phrase.id}
                              type="button"
                              onClick={() => appendPhrase(phrase.text)}
                              className="px-2.5 py-1 rounded border border-stone-200 bg-stone-50 text-[11px] text-stone-700 hover:bg-stone-100 transition-colors cursor-pointer"
                            >
                              + {phrase.text}
                            </button>
                          ))}
                        </div>
                      )}
                      {pluginSnippets.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-stone-100">
                          <span className="text-[11px] font-medium text-[#1E3A8A]">
                            প্লাগইন ব্লক:
                          </span>
                          {pluginSnippets.map((snip) => (
                            <button
                              key={snip.id}
                              type="button"
                              onClick={() => appendPhrase(snip.text)}
                              className="px-2.5 py-1 rounded border border-[#1E3A8A]/25 bg-[#1E3A8A]/5 text-[11px] font-medium text-[#1E3A8A] hover:bg-[#1E3A8A]/10 transition-colors cursor-pointer"
                            >
                              + {snip.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {subTab === "recipient" && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="editor-ref-number"
                      className="block text-xs font-medium text-stone-700 mb-1.5"
                    >
                      স্মারক নম্বর
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        id="editor-ref-number"
                        name="refNumber"
                        type="text"
                        value={letter.refNumber}
                        onChange={(e) => updateField("refNumber", e.target.value)}
                        className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm tabular-nums text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                      />
                      <button
                        type="button"
                        title="নতুন স্মারক নম্বর তৈরি করুন"
                        aria-label="নতুন স্মারক নম্বর তৈরি করুন"
                        onClick={() =>
                          updateField(
                            "refNumber",
                            generateNextRefNumber(org.refPrefix, "পত্র")
                          )
                        }
                        className="h-10 px-3 rounded-lg border border-stone-300 bg-stone-50 text-stone-700 hover:bg-stone-100 shrink-0 cursor-pointer"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="editor-date-text"
                      className="block text-xs font-medium text-stone-700 mb-1.5"
                    >
                      তারিখ
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        id="editor-date-text"
                        name="dateText"
                        type="text"
                        value={letter.dateText}
                        onChange={(e) => updateField("dateText", e.target.value)}
                        className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm tabular-nums text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const now = new Date();
                          onChange({
                            ...letter,
                            dateText: formatBengaliDate(now),
                            banglaDateText: formatBanglaCalendarDate(now),
                          });
                        }}
                        className="h-10 px-2.5 rounded-lg border border-stone-300 bg-stone-50 text-xs font-medium text-stone-700 hover:bg-stone-100 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        আজ
                      </button>
                    </div>
                  </div>
                </div>

                <label
                  htmlFor="editor-show-bangla-date"
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-stone-50 border border-stone-200 cursor-pointer"
                >
                  <div>
                    <p className="text-xs font-medium text-stone-800">
                      বঙ্গাব্দ তারিখ প্রদর্শন
                    </p>
                    <p className="text-[11px] text-stone-500">
                      {letter.banglaDateText}
                    </p>
                  </div>
                  <input
                    id="editor-show-bangla-date"
                    name="showBanglaDate"
                    type="checkbox"
                    checked={letter.showBanglaDate}
                    onChange={(e) => updateField("showBanglaDate", e.target.checked)}
                    className="w-4 h-4 accent-[#1E3A8A] cursor-pointer"
                  />
                </label>

                <div className="pt-2 border-t border-stone-200 space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label
                        htmlFor="editor-recipient-prefix"
                        className="block text-xs font-medium text-stone-700 mb-1.5"
                      >
                        উপসর্গ
                      </label>
                      <select
                        id="editor-recipient-prefix"
                        name="recipientPrefix"
                        value={letter.recipientPrefix}
                        onChange={(e) => updateField("recipientPrefix", e.target.value)}
                        className="w-full h-10 rounded-lg border border-stone-300 bg-white px-2.5 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                      >
                        <option value="বরাবর">বরাবর</option>
                        <option value="প্রাপক">প্রাপক</option>
                        <option value="সুধী">সুধী</option>
                        <option value="">(খালি)</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label
                        htmlFor="editor-recipient-name"
                        className="block text-xs font-medium text-stone-700 mb-1.5"
                      >
                        প্রাপকের নাম / পদ
                      </label>
                      <input
                        id="editor-recipient-name"
                        name="recipientName"
                        type="text"
                        value={letter.recipientName}
                        onChange={(e) => updateField("recipientName", e.target.value)}
                        className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="editor-recipient-title"
                        className="block text-xs font-medium text-stone-700 mb-1.5"
                      >
                        পদবি / শাখা
                      </label>
                      <input
                        id="editor-recipient-title"
                        name="recipientTitle"
                        type="text"
                        value={letter.recipientTitle}
                        onChange={(e) => updateField("recipientTitle", e.target.value)}
                        className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="editor-recipient-org"
                        className="block text-xs font-medium text-stone-700 mb-1.5"
                      >
                        প্রাপকের প্রতিষ্ঠান
                      </label>
                      <input
                        id="editor-recipient-org"
                        name="recipientOrg"
                        type="text"
                        value={letter.recipientOrg}
                        onChange={(e) => updateField("recipientOrg", e.target.value)}
                        className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="editor-recipient-address"
                      className="block text-xs font-medium text-stone-700 mb-1.5"
                    >
                      প্রাপকের ঠিকানা
                    </label>
                    <input
                      id="editor-recipient-address"
                      name="recipientAddress"
                      type="text"
                      value={letter.recipientAddress}
                      onChange={(e) => updateField("recipientAddress", e.target.value)}
                      className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-stone-200 space-y-3">
                  <div>
                    <label
                      htmlFor="editor-attachments"
                      className="block text-xs font-medium text-stone-700 mb-1.5"
                    >
                      সংযুক্তি (প্রতি লাইনে একটি)
                    </label>
                    <textarea
                      id="editor-attachments"
                      name="attachments"
                      rows={2}
                      value={letter.attachments}
                      onChange={(e) => updateField("attachments", e.target.value)}
                      placeholder="১. জাতীয় পরিচয়পত্রের কপি"
                      className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="editor-cc-list"
                      className="block text-xs font-medium text-stone-700 mb-1.5"
                    >
                      অনুলিপি (CC)
                    </label>
                    <textarea
                      id="editor-cc-list"
                      name="ccList"
                      rows={2}
                      value={letter.ccList}
                      onChange={(e) => updateField("ccList", e.target.value)}
                      placeholder="১. অফিস নথি"
                      className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                    />
                  </div>
                </div>
              </>
            )}

            {subTab === "design" && (
              <>
                {branchPadEnabled && configuredBranchPadNames.length > 0 && (
                  <div className="p-3.5 rounded-lg border border-[#1E3A8A]/20 bg-[#1E3A8A]/5 space-y-2">
                    <label
                      htmlFor="editor-branch-pad-select"
                      className="block text-xs font-semibold text-stone-900"
                    >
                      শাখাভিত্তিক প্যাড ও নিচের স্বাক্ষরকারী নির্বাচন
                    </label>
                    <select
                      id="editor-branch-pad-select"
                      name="branchPadDepartment"
                      value={letter.branchPadDepartment || ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        const chosen =
                          val && val !== "__default__" ? branchPadMap[val] : undefined;
                        onChange({
                          ...letter,
                          branchPadDepartment: val || undefined,
                          ...(chosen?.letterheadStyle
                            ? { letterheadStyle: chosen.letterheadStyle }
                            : {}),
                          ...(chosen?.letterFont
                            ? { letterFont: chosen.letterFont }
                            : {}),
                        });
                      }}
                      className="w-full h-10 rounded-lg border border-stone-300 bg-white px-3 text-xs font-medium text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                    >
                      <option value="">
                        স্বয়ংক্রিয় (টেমপ্লেট বা ব্যবহারকারীর শাখা অনুযায়ী)
                      </option>
                      {configuredBranchPadNames.map((deptName) => {
                        const sigCount =
                          branchPadMap[deptName]?.signatories?.length || 0;
                        return (
                          <option key={deptName} value={deptName}>
                            {deptName} ({toBengaliDigits(sigCount)} জন স্বাক্ষরকারী)
                          </option>
                        );
                      })}
                      <option value="__default__">
                        প্রতিষ্ঠানের মূল প্যাড (একক স্বাক্ষরকারী)
                      </option>
                    </select>
                    {activeBranchPad && (
                      <p className="text-[11px] text-stone-700 leading-relaxed">
                        সক্রিয় প্যাড:{" "}
                        <span className="font-semibold">
                          {activeBranchPad.config.branchTitleBn ||
                            activeBranchPad.departmentName}
                        </span>
                        {activeBranchPad.config.signatories.length > 0 &&
                          ` · নিচে ${toBengaliDigits(
                            activeBranchPad.config.signatories.length
                          )} জন স্বাক্ষরকারী প্রদর্শিত হচ্ছে।`}
                      </p>
                    )}
                  </div>
                )}

                <div className="space-y-3">
                  <div>
                    <label
                      htmlFor="editor-signatory-name"
                      className="block text-xs font-medium text-stone-700 mb-1.5"
                    >
                      স্বাক্ষরকারীর নাম
                    </label>
                    <input
                      id="editor-signatory-name"
                      name="signatoryName"
                      type="text"
                      value={letter.signatoryName}
                      onChange={(e) => updateField("signatoryName", e.target.value)}
                      className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="editor-signatory-title"
                        className="block text-xs font-medium text-stone-700 mb-1.5"
                      >
                        স্বাক্ষরকারীর পদবি
                      </label>
                      <input
                        id="editor-signatory-title"
                        name="signatoryTitle"
                        type="text"
                        value={letter.signatoryTitle}
                        onChange={(e) => updateField("signatoryTitle", e.target.value)}
                        className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="editor-signatory-dept"
                        className="block text-xs font-medium text-stone-700 mb-1.5"
                      >
                        বিভাগ / শাখা
                      </label>
                      <input
                        id="editor-signatory-dept"
                        name="signatoryDept"
                        type="text"
                        value={letter.signatoryDept}
                        onChange={(e) => updateField("signatoryDept", e.target.value)}
                        className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-stone-200">
                  <p className="text-xs font-medium text-stone-700 mb-2">
                    প্যাডের লেআউট শৈলী
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { id: "classic", label: "ক্লাসিক দাপ্তরিক" },
                        { id: "modern", label: "আধুনিক কর্পোরেট" },
                        { id: "archival", label: "ঐতিহ্যবাহী স্মারক" },
                      ] as { id: LetterheadStyle; label: string }[]
                    ).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => updateField("letterheadStyle", item.id)}
                        className={`py-2.5 px-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                          letter.letterheadStyle === item.id
                            ? "border-[#1E3A8A] bg-[#1E3A8A]/5 text-[#1E3A8A]"
                            : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t border-stone-200">
                  <p className="text-xs font-medium text-stone-700 mb-2">
                    মুদ্রণ ও প্রদর্শনের ফন্ট
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(
                      [
                        { id: "sutonnymj", label: "দাপ্তরিক ছাপা (Office: SutonnyMJ)" },
                        { id: "serif", label: "তিরো বাংলা (সেরিফ)" },
                      ] as { id: LetterFont; label: string }[]
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => updateField("letterFont", f.id)}
                        className={`py-2.5 px-2.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                          letter.letterFont === f.id
                            ? "border-[#1E3A8A] bg-[#1E3A8A]/5 text-[#1E3A8A]"
                            : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t border-stone-200">
                  <p className="text-xs font-medium text-stone-700 mb-2">
                    ওয়ার্ড ও এক্সেল রূপান্তর ফন্ট এনকোডিং
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setOfficeFontMode("bijoy")}
                      className={`py-2 px-3 rounded-lg border text-left text-xs transition-colors cursor-pointer ${
                        officeFontMode === "bijoy"
                          ? "border-[#1E3A8A] bg-[#1E3A8A]/5 text-[#1E3A8A]"
                          : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                      }`}
                    >
                      <span className="block font-semibold">
                        সুতনি এমজে (বিজয় এনএসআই)
                      </span>
                      <span className="block text-[11px] opacity-80">
                        MS Word ও MS Excel-এ সরাসরি SutonnyMJ ফন্টে খোলে
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setOfficeFontMode("unicode")}
                      className={`py-2 px-3 rounded-lg border text-left text-xs transition-colors cursor-pointer ${
                        officeFontMode === "unicode"
                          ? "border-[#1E3A8A] bg-[#1E3A8A]/5 text-[#1E3A8A]"
                          : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                      }`}
                    >
                      <span className="block font-semibold">
                        ইউনিকোড (সুতনি এমজে / ওয়েব)
                      </span>
                      <span className="block text-[11px] opacity-80">
                        গুগল ডকস ও ইউনিকোড সিস্টেমের জন্য উপযোগী
                      </span>
                    </button>
                  </div>
                </div>

                <div className="pt-3 border-t border-stone-200 space-y-2.5">
                  <label
                    htmlFor="editor-show-watermark"
                    className="flex items-center justify-between py-2 px-3 rounded-lg bg-stone-50 border border-stone-200 cursor-pointer"
                  >
                    <span className="text-xs font-medium text-stone-800">
                      শিরোনামে প্রতিষ্ঠানের প্রতীক / লোগো দেখান
                    </span>
                    <input
                      id="editor-show-watermark"
                      name="showWatermark"
                      type="checkbox"
                      checked={letter.showWatermark}
                      onChange={(e) => updateField("showWatermark", e.target.checked)}
                      className="w-4 h-4 accent-[#1E3A8A]"
                    />
                  </label>
                  <label
                    htmlFor="editor-show-seal"
                    className="flex items-center justify-between py-2 px-3 rounded-lg bg-stone-50 border border-stone-200 cursor-pointer"
                  >
                    <span className="text-xs font-medium text-stone-800">
                      প্রতিষ্ঠানের সীলমোহরের বক্স রাখুন
                    </span>
                    <input
                      id="editor-show-seal"
                      name="showSealPlaceholder"
                      type="checkbox"
                      checked={letter.showSealPlaceholder}
                      onChange={(e) =>
                        updateField("showSealPlaceholder", e.target.checked)
                      }
                      className="w-4 h-4 accent-[#1E3A8A]"
                    />
                  </label>
                </div>
              </>
            )}

            {subTab === "history" && (
              <div className="space-y-3.5">
                <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-stone-200">
                  <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-[#1E3A8A]" />
                    <div>
                      <h2 className="text-xs font-semibold text-stone-900">
                        স্থানীয় সংশোধন ইতিহাস (Revision History)
                      </h2>
                      <p className="text-[11px] text-stone-500">
                        সংরক্ষণের পূর্বে করা প্রতিটি ছোট পরিবর্তন স্বয়ংক্রিয়ভাবে সংরক্ষিত হয়
                      </p>
                    </div>
                  </div>
                  {revisions.length > 1 && (
                    <button
                      type="button"
                      onClick={handleClearRevisions}
                      title="ইতিহাস পরিষ্কার করুন"
                      aria-label="ইতিহাস পরিষ্কার করুন"
                      className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-stone-200 text-[11px] font-medium text-stone-600 hover:text-red-700 hover:bg-red-50 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>পরিষ্কার</span>
                    </button>
                  )}
                </div>

                <div className="max-h-[430px] overflow-y-auto divide-y divide-stone-200 border border-stone-200 rounded-lg bg-white">
                  {revisions.map((rev, idx) => {
                    const isLatest = idx === 0;
                    const previewSnippet =
                      rev.snapshot.subject ||
                      rev.snapshot.body.slice(0, 80) ||
                      "খালি খসড়া";
                    return (
                      <div
                        key={rev.id}
                        className={`p-3 space-y-1.5 ${
                          isLatest ? "bg-stone-50/80" : "hover:bg-stone-50/50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500 tabular-nums">
                              <span className="font-semibold text-stone-800">
                                {rev.timestamp}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>
                                {rev.isSavedPoint
                                  ? "সংরক্ষিত বিন্দু"
                                  : isLatest
                                    ? "সর্বশেষ অবস্থা"
                                    : `সংস্করণ #${toBengaliDigits(revisions.length - idx)}`}
                              </span>
                            </div>
                            <p className="text-xs font-semibold text-stone-900 mt-0.5">
                              {rev.summary}
                            </p>
                          </div>

                          {!isLatest && (
                            <button
                              type="button"
                              onClick={() => handleRestoreRevision(rev)}
                              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-stone-300 bg-white text-[11px] font-medium text-stone-800 hover:bg-[#1E3A8A] hover:text-white hover:border-[#1E3A8A] transition-colors shrink-0 cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>ফিরিয়ে আনুন</span>
                            </button>
                          )}
                        </div>

                        <p className="text-[11px] text-stone-600 line-clamp-2">
                          {previewSnippet}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* RIGHT COLUMN: LIVE A4 DOCUMENT PREVIEW */}
        <section
          data-section="editor-preview"
          aria-label="এ-৪ চিঠির লাইভ প্রিভিউ"
          className="print-reset-container lg:col-span-7"
        >
          {/* Preview Action Toolbar */}
          <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-3 bg-white border border-stone-200 rounded-xl px-4 py-2.5">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 p-1 bg-stone-100 rounded-lg">
                {([0.7, 0.85, 1] as const).map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => setZoom(z)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md tabular-nums transition-colors cursor-pointer ${
                      zoom === z
                        ? "bg-white text-stone-900 shadow-xs"
                        : "text-stone-600 hover:text-stone-900"
                    }`}
                  >
                    {toBengaliDigits(Math.round(z * 100))}%
                  </button>
                ))}
              </div>
              <span className="hidden sm:inline text-xs text-stone-500 tabular-nums">
                {fitScale < 0.999
                  ? `এ-৪ ১ পেজ ফিট (${toBengaliDigits(Math.round(fitScale * 100))}%)`
                  : "এ-৪ · ১ পেজ"}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {savedNotice ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-700" />
                    <span className="text-emerald-700">সংরক্ষিত</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>{isSaving ? "সংরক্ষণ হচ্ছে..." : "সংরক্ষণ"}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleCopyText}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-700 hover:bg-stone-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-700" />
                    <span className="text-emerald-700">অনুলিপি সম্পন্ন</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>লেখা অনুলিপি</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleWordExport}
                title="SutonnyMJ ফন্টে MS Word (.doc) ডাউনলোড"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-700 hover:bg-stone-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileDown className="w-3.5 h-3.5" />
                <span>ওয়ার্ড (.doc)</span>
              </button>

              <button
                type="button"
                onClick={handleExcelExport}
                title="SutonnyMJ ফন্টে MS Excel (.xls) ডাউনলোড"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-700 hover:bg-stone-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                <span>এক্সেল (.xls)</span>
              </button>

              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-700 hover:bg-stone-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>মুদ্রণ (প্রিন্ট)</span>
              </button>

              <button
                type="button"
                onClick={handlePdfDownload}
                disabled={isExportingPdf}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#1E3A8A] text-xs font-medium text-white hover:bg-[#172D6B] disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileDown className="w-3.5 h-3.5" />
                <span>{isExportingPdf ? "পিডিএফ হচ্ছে..." : "পিডিএফ ডাউনলোড"}</span>
              </button>
            </div>
          </div>

          {exportError && (
            <div
              role="alert"
              className="no-print mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs text-red-800"
            >
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{exportError}</span>
            </div>
          )}

          {/* Paper Canvas */}
          <div className="print-reset-container rounded-xl bg-[#EAE8E1] border border-stone-200 p-4 sm:p-6 overflow-x-auto flex justify-center">
            <div
              className="print-reset-zoom origin-top transition-transform duration-150"
              style={{
                width: `calc(210mm * ${zoom})`,
                height: `calc(297mm * ${zoom})`,
              }}
            >
              <div
                className="print-reset-zoom origin-top-left shadow-[0_8px_30px_rgb(28,25,23,0.09)] border border-stone-200/80"
                style={{
                  transform: `scale(${zoom})`,
                  width: "210mm",
                  height: "297mm",
                }}
              >
                <LetterPreview
                  letter={letter}
                  org={org}
                  branchPad={activeBranchPad?.config || null}
                  exportRef={exportRef}
                  autoFitOnePage={true}
                  onFitScaleChange={setFitScale}
                />
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Sandboxed Iframe Print Helper Dialog */}
      {showPrintDialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="print-dialog-title"
          className="no-print fixed inset-0 z-50 bg-stone-950/50 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-stone-200 rounded-xl max-w-md w-full p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <h2
                id="print-dialog-title"
                className="text-base font-bold text-stone-900"
              >
                প্রিন্ট ও পিডিএফ প্রস্তুত
              </h2>
              <button
                type="button"
                onClick={() => setShowPrintDialog(false)}
                aria-label="বন্ধ করুন"
                className="text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="mt-2.5 text-sm text-stone-600 leading-relaxed">
              প্রিভিউ ফ্রেমে ব্রাউজার সরাসরি প্রিন্ট পপ-আপ সীমাবদ্ধ রাখায় নিচের বোতাম থেকে আলাদা ট্যাবে ১-পেজ প্রিন্ট চালু করুন অথবা সরাসরি পিডিএফ ডাউনলোড করুন।
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              <a
                href={printFallbackUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setShowPrintDialog(false)}
                className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-[#1E3A8A] text-xs font-semibold text-white hover:bg-[#172D6B] transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                <span>নতুন ট্যাবে প্রিন্ট করুন</span>
              </a>
              <button
                type="button"
                onClick={() => {
                  setShowPrintDialog(false);
                  void handlePdfDownload();
                }}
                className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg border border-stone-300 bg-white text-xs font-semibold text-stone-800 hover:bg-stone-50 transition-colors cursor-pointer"
              >
                <FileDown className="w-4 h-4" />
                <span>সরাসরি ১-পেজ পিডিএফ ডাউনলোড</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
