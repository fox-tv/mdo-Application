import React, { useEffect, useRef, useState } from "react";
import { Camera, Clock, User } from "lucide-react";
import type { CustomUiBlock, PublicUser, UiBlockPlacement } from "../types";
import { apiRequest } from "../utils/api";
import {
  formatBanglaCalendarDate,
  formatBengaliDate,
  toBengaliDigits,
} from "../utils/bengali";

const WEEKDAYS_BN = [
  "রবিবার",
  "সোমবার",
  "মঙ্গলবার",
  "বুধবার",
  "বৃহস্পতিবার",
  "শুক্রবার",
  "শনিবার",
];

function getBanglaPeriodAnd12Hour(date: Date): { period: string; timeStr: string } {
  const h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");

  let period = "রাত";
  if (h >= 5 && h < 12) period = "সকাল";
  else if (h >= 12 && h < 15) period = "দুপুর";
  else if (h >= 15 && h < 18) period = "বিকাল";
  else if (h >= 18 && h < 20) period = "সন্ধ্যা";

  const h12 = h % 12 || 12;
  const hStr = String(h12).padStart(2, "0");
  return {
    period,
    timeStr: toBengaliDigits(`${hStr}:${m}:${s}`),
  };
}

export function isSafeImageSrc(src: unknown): src is string {
  if (typeof src !== "string") return false;
  const trimmed = src.trim();
  if (!trimmed) return false;
  return (
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("/") ||
    /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);/i.test(trimmed)
  );
}

export function sanitizeClientHtml(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[\s\S]*?>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/<\/?(meta|link|base|form)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\b(javascript|vbscript|data:text\/html)\s*:/gi, "blocked:");
}

export const LiveBengaliClock: React.FC<{
  compact?: boolean;
  accentColor?: string;
}> = ({ compact = false, accentColor = "#1E3A8A" }) => {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const { period, timeStr } = getBanglaPeriodAnd12Hour(now);
  const weekday = WEEKDAYS_BN[now.getDay()];
  const gDate = formatBengaliDate(now);
  const bDate = formatBanglaCalendarDate(now);

  if (compact) {
    return (
      <div
        data-widget="live-clock"
        className="inline-flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs text-stone-700"
      >
        <Clock className="w-3.5 h-3.5 shrink-0" style={{ color: accentColor }} />
        <span className="font-semibold tabular-nums text-stone-900">
          {period} {timeStr}
        </span>
        <span aria-hidden="true" className="text-stone-300">
          |
        </span>
        <span>
          {weekday}, {gDate}
        </span>
      </div>
    );
  }

  return (
    <div
      data-widget="live-clock"
      className="rounded-xl border border-stone-200 bg-stone-50/80 px-4 py-3 text-left"
    >
      <div className="flex items-center gap-2 text-xs text-stone-500">
        <Clock className="w-3.5 h-3.5 shrink-0" style={{ color: accentColor }} />
        <span>বর্তমান সময় ও তারিখ</span>
      </div>
      <p className="mt-1 text-lg font-bold tabular-nums text-stone-900 tracking-tight">
        {period} {timeStr}
      </p>
      <p className="mt-0.5 text-xs text-stone-600">
        {weekday}, {gDate} · {bDate}
      </p>
    </div>
  );
};

export const UserAvatarBadge: React.FC<{
  user: PublicUser;
  size?: "sm" | "lg";
  primaryColor?: string;
  allowUpload?: boolean;
  onAvatarUpdated?: (updated: PublicUser) => void;
}> = ({
  user,
  size = "lg",
  primaryColor = "#1E3A8A",
  allowUpload = false,
  onAvatarUpdated,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const avatarSrc = user.avatarDataUrl || user.avatarUrl || "";
  const hasImage = isSafeImageSrc(avatarSrc);
  const initials = (user.fullName || user.userId || "U")
    .trim()
    .slice(0, 2);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !onAvatarUpdated) return;
    if (file.size > 1_500_000) return;

    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result !== "string") return;
      setUploading(true);
      try {
        const res = await apiRequest<{ user: PublicUser }>("/api/auth/avatar", {
          method: "POST",
          body: JSON.stringify({ avatarDataUrl: reader.result }),
        });
        onAvatarUpdated(res.user);
      } catch {
        // Non-blocking fallback
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  if (size === "sm") {
    return (
      <span
        data-widget="user-avatar-sm"
        className="w-6 h-6 rounded-full overflow-hidden border border-stone-200 bg-stone-100 flex items-center justify-center shrink-0"
      >
        {hasImage ? (
          <img
            src={avatarSrc}
            alt={user.fullName}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
        ) : (
          <User className="w-3.5 h-3.5 text-stone-500" />
        )}
      </span>
    );
  }

  return (
    <div data-widget="user-avatar" className="relative shrink-0">
      <div
        className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden border-2 border-stone-200 bg-stone-100 flex items-center justify-center shadow-xs"
        style={{ borderColor: `${primaryColor}33` }}
      >
        {hasImage ? (
          <img
            src={avatarSrc}
            alt={user.fullName}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-stone-500">
            <User className="w-7 h-7" style={{ color: primaryColor }} />
            <span className="text-[10px] font-semibold mt-0.5 text-stone-600">
              {initials}
            </span>
          </div>
        )}
      </div>

      {allowUpload && onAvatarUpdated && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={(e) => void handleFileChange(e)}
            className="hidden"
            aria-label="ব্যবহারকারীর ছবি নির্বাচন করুন"
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            title="প্রোফাইল ছবি আপলোড বা পরিবর্তন করুন"
            aria-label="প্রোফাইল ছবি পরিবর্তন"
            className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-white border border-stone-300 shadow-xs flex items-center justify-center text-stone-700 hover:bg-stone-50 cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5" style={{ color: primaryColor }} />
          </button>
        </>
      )}
    </div>
  );
};

export const CustomBlocksZone: React.FC<{
  blocks?: CustomUiBlock[];
  placement: UiBlockPlacement;
  user?: PublicUser | null;
  primaryColor?: string;
}> = ({ blocks = [], placement, user, primaryColor = "#1E3A8A" }) => {
  const active = blocks.filter((b) => b.enabled && b.placement === placement);
  if (active.length === 0) return null;

  if (placement === "header-right") {
    return (
      <div className="hidden sm:flex items-center gap-2">
        {active.map((blk) => (
          <div
            key={blk.id}
            data-custom-block={blk.id}
            className="flex items-center gap-2 text-xs text-stone-700"
          >
            {blk.kind === "clock" && (
              <LiveBengaliClock compact accentColor={blk.accentColor || primaryColor} />
            )}
            {(blk.kind === "image" || blk.kind === "image-banner") && isSafeImageSrc(blk.imageUrl) && (
              <img
                src={blk.imageUrl}
                alt={blk.title || "কাস্টম ছবি"}
                referrerPolicy="no-referrer"
                className="h-8 w-auto max-w-[120px] rounded object-cover border border-stone-200"
              />
            )}
            {blk.kind !== "clock" && blk.kind !== "image" && blk.kind !== "image-banner" && blk.title && (
              <span className="font-medium text-stone-700">{blk.title}</span>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      data-section={`custom-zone-${placement}`}
      className="no-print space-y-4"
    >
      {active.map((blk) => {
        const accent = blk.accentColor || primaryColor;

        if (blk.kind === "clock") {
          return (
            <div
              key={blk.id}
              data-custom-block={blk.id}
              className="bg-white border border-stone-200 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div>
                {blk.title && (
                  <h3 className="text-sm font-bold text-stone-900">{blk.title}</h3>
                )}
                {blk.subtitle && (
                  <p className="text-xs text-stone-600 mt-0.5">{blk.subtitle}</p>
                )}
              </div>
              <LiveBengaliClock accentColor={accent} />
            </div>
          );
        }

        if (blk.kind === "image" || blk.kind === "image-banner") {
          return (
            <div
              key={blk.id}
              data-custom-block={blk.id}
              className="bg-white border border-stone-200 rounded-xl overflow-hidden"
            >
              {isSafeImageSrc(blk.imageUrl) && (
                <img
                  src={blk.imageUrl}
                  alt={blk.title || "প্রদর্শিত ছবি"}
                  referrerPolicy="no-referrer"
                  className="w-full max-h-64 object-cover bg-stone-100"
                />
              )}
              {(blk.title || blk.subtitle) && (
                <div className="px-5 py-3.5 border-t border-stone-100">
                  {blk.title && (
                    <h3 className="text-sm font-bold text-stone-900">{blk.title}</h3>
                  )}
                  {blk.subtitle && (
                    <p className="text-xs text-stone-600 mt-0.5 leading-relaxed">
                      {blk.subtitle}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        }

        if ((blk.kind === "user-card" || blk.kind === "user-profile") && user) {
          return (
            <div
              key={blk.id}
              data-custom-block={blk.id}
              className="bg-white border border-stone-200 rounded-xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <UserAvatarBadge user={user} size="lg" primaryColor={accent} />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-stone-900 truncate">
                    {blk.title || user.fullName}
                  </p>
                  <p className="text-xs text-stone-600 mt-0.5 truncate">
                    {blk.subtitle || `${user.designation || "কর্মকর্তা"} · ${user.department}`}
                  </p>
                </div>
              </div>
              <LiveBengaliClock compact accentColor={accent} />
            </div>
          );
        }

        if (blk.kind === "html-card" && blk.htmlContent) {
          return (
            <div
              key={blk.id}
              data-custom-block={blk.id}
              className="bg-white border border-stone-200 rounded-xl p-4 sm:p-5 overflow-x-auto"
            >
              {blk.title && (
                <h3 className="text-sm font-bold text-stone-900 mb-2">{blk.title}</h3>
              )}
              <div
                className="text-sm text-stone-800"
                dangerouslySetInnerHTML={{
                  __html: sanitizeClientHtml(blk.htmlContent),
                }}
              />
            </div>
          );
        }

        // Default: notice / info card
        return (
          <div
            key={blk.id}
            data-custom-block={blk.id}
            className="bg-white border border-stone-200 rounded-xl px-5 py-4"
          >
            {blk.title && (
              <h3 className="text-sm font-bold" style={{ color: accent }}>
                {blk.title}
              </h3>
            )}
            {(blk.subtitle || blk.content) && (
              <p className="text-xs text-stone-600 mt-1 leading-relaxed">
                {blk.subtitle || blk.content}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};
