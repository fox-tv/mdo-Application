import type { AdminTab } from "../components/AdminPanelView";
import type { AppTab } from "../types";

export const VALID_APP_TABS: AppTab[] = [
  "dashboard",
  "editor",
  "templates",
  "saved",
  "voice",
  "organization",
  "admin",
];

export const VALID_ADMIN_TABS: AdminTab[] = [
  "site",
  "ai-assistant",
  "plugins",
  "users",
  "templates",
  "template-access",
  "branch-pads",
  "departments",
  "developer",
  "security",
];

export interface ParsedAppRoute {
  tab: AppTab | null;
  adminTab?: AdminTab;
  letterId?: string;
}

export function getAppBasePath(): string {
  const rawBase =
    typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
      ? import.meta.env.BASE_URL
      : "/";
  if (!rawBase || rawBase === "/") return "";
  return rawBase.replace(/\/+$/, "");
}

export function buildAppPath(
  tab: AppTab,
  options?: { adminTab?: AdminTab; letterId?: string }
): string {
  const base = getAppBasePath();
  if (tab === "admin") {
    const sub = options?.adminTab;
    return sub ? `${base}/admin/${sub}` : `${base}/admin`;
  }
  if (tab === "editor" && options?.letterId) {
    return `${base}/editor/${encodeURIComponent(options.letterId)}`;
  }
  return `${base}/${tab}`;
}

export function parseAppRoute(pathname: string): ParsedAppRoute {
  const base = getAppBasePath();
  let rel = pathname || "/";
  if (base && rel.startsWith(base)) {
    rel = rel.slice(base.length) || "/";
  }
  const segments = rel
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return { tab: null };
  }

  const head = segments[0];
  if (!VALID_APP_TABS.includes(head as AppTab)) {
    return { tab: null };
  }

  const tab = head as AppTab;
  if (tab === "admin") {
    const sub = segments[1];
    const adminTab =
      sub && VALID_ADMIN_TABS.includes(sub as AdminTab)
        ? (sub as AdminTab)
        : undefined;
    return { tab, adminTab };
  }

  if (tab === "editor" && segments[1]) {
    try {
      return { tab, letterId: decodeURIComponent(segments[1]) };
    } catch {
      return { tab, letterId: segments[1] };
    }
  }

  return { tab };
}
