import React, { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import type { PublicUser } from "../types";
import {
  formatBanglaCalendarDate,
  formatBengaliDate,
  toBengaliDigits,
} from "../utils/bengali";
import { UserAvatarBadge, isSafeImageSrc } from "./DynamicUiElements";

interface UserProfileHeaderProps {
  user: PublicUser;
  orgNameBn?: string;
  badgeLabel?: string;
  primaryColor?: string;
  showAvatar?: boolean;
  onUserUpdated?: (updated: PublicUser) => void;
  extraRight?: React.ReactNode;
  actions?: React.ReactNode;
}

const BENGALI_WEEKDAYS = [
  "রবিবার",
  "সোমবার",
  "মঙ্গলবার",
  "বুধবার",
  "বৃহস্পতিবার",
  "শুক্রবার",
  "শনিবার",
];

function getBengaliDayPeriod(hour24: number): string {
  if (hour24 >= 5 && hour24 < 12) return "সকাল";
  if (hour24 >= 12 && hour24 < 15) return "দুপুর";
  if (hour24 >= 15 && hour24 < 18) return "বিকাল";
  if (hour24 >= 18 && hour24 < 20) return "সন্ধ্যা";
  return "রাত";
}

function formatLocalTimeBn(date: Date): string {
  const hour24 = date.getHours();
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const hh = String(hour12).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const period = getBengaliDayPeriod(hour24);
  return `${period} ${toBengaliDigits(`${hh}:${mm}:${ss}`)}`;
}

export const UserProfileHeader: React.FC<UserProfileHeaderProps> = ({
  user,
  orgNameBn,
  badgeLabel,
  primaryColor = "#1E3A8A",
  showAvatar = false,
  onUserUpdated,
  extraRight,
  actions,
}) => {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const designationOrDept =
    user.designation?.trim() ||
    (user.role === "admin" ? "সিস্টেম অ্যাডমিন" : "কর্মকর্তা");
  const departmentLabel = user.department?.trim() || "সকল বিভাগ";
  const weekdayBn = BENGALI_WEEKDAYS[now.getDay()] || "";
  const localTimeBn = formatLocalTimeBn(now);
  const gregorianDateBn = formatBengaliDate(now);
  const banglaDateBn = formatBanglaCalendarDate(now);
  const shouldShowAvatar =
    showAvatar || isSafeImageSrc(user.avatarDataUrl || user.avatarUrl);

  return (
    <div
      data-section="user-profile-header"
      className="flex flex-col lg:flex-row lg:items-center justify-between gap-5"
    >
      <div className="flex items-start sm:items-center gap-4 min-w-0">
        {shouldShowAvatar && (
          <UserAvatarBadge
            user={user}
            size="lg"
            primaryColor={primaryColor}
            allowUpload={Boolean(onUserUpdated)}
            onAvatarUpdated={onUserUpdated}
          />
        )}

        <div className="min-w-0">
          <p className="text-xs font-medium text-stone-500">
            {badgeLabel || "স্বাগতম · ব্যবহারকারী ড্যাশবোর্ড"}
          </p>

          <h1 className="mt-0.5 text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight break-words">
            {user.fullName}
          </h1>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-stone-700">
            <span className="font-semibold" style={{ color: primaryColor }}>
              {designationOrDept}
            </span>
            <span aria-hidden="true" className="text-stone-400">
              ·
            </span>
            <span>{departmentLabel}</span>
            <span aria-hidden="true" className="text-stone-400">
              ·
            </span>
            <span className="font-mono-tabular text-xs text-stone-500">
              আইডি: {user.userId}
            </span>
            {orgNameBn && (
              <>
                <span aria-hidden="true" className="text-stone-400">
                  ·
                </span>
                <span className="text-xs text-stone-500">{orgNameBn}</span>
              </>
            )}
          </div>

          <div
            data-widget="live-clock"
            aria-label="বর্তমান স্থানীয় সময় ও তারিখ"
            className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-stone-600 tabular-nums"
          >
            <span className="inline-flex items-center gap-1.5 font-semibold text-stone-800">
              <Clock
                className="w-3.5 h-3.5 shrink-0"
                style={{ color: primaryColor }}
              />
              <time dateTime={now.toISOString()}>{localTimeBn}</time>
            </span>
            <span aria-hidden="true" className="text-stone-400">
              ·
            </span>
            <span>{weekdayBn}</span>
            <span aria-hidden="true" className="text-stone-400">
              ·
            </span>
            <span>{gregorianDateBn}</span>
            <span aria-hidden="true" className="text-stone-400">
              ·
            </span>
            <span className="text-stone-500">{banglaDateBn}</span>
          </div>
        </div>
      </div>

      {(extraRight || actions) && (
        <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end gap-3 shrink-0">
          {extraRight}
          {actions && (
            <div className="flex flex-wrap items-center gap-2.5">
              {actions}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
