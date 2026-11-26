import type {
  BranchPadConfig,
  LetterData,
  LetterTemplate,
  OrganizationProfile,
  SavedLetter,
  SitePlugin,
} from "../types";

export const USER_PAD_PREFIX = "user:";

export function makeUserPadKey(userId: string): string {
  return `${USER_PAD_PREFIX}${userId.trim()}`;
}

export function parseUserPadKey(value?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith(USER_PAD_PREFIX)) return null;
  const uid = trimmed.slice(USER_PAD_PREFIX.length).trim();
  return uid || null;
}

export function getBranchPadPlugin(
  plugins: SitePlugin[]
): SitePlugin | undefined {
  return plugins.find((p) => p.type === "branch-pad-designer");
}

export function isBranchPadPluginEnabled(plugins: SitePlugin[]): boolean {
  const plg = getBranchPadPlugin(plugins);
  return plg ? plg.enabled : false;
}

export function isUserSelfPadCustomizeEnabled(plugins: SitePlugin[]): boolean {
  const plg = getBranchPadPlugin(plugins);
  if (!plg || !plg.enabled) return false;
  return plg.config?.allowUserSelfPadCustomize !== false;
}

export function getBranchPadMap(
  plugins: SitePlugin[]
): Record<string, BranchPadConfig> {
  const plg = getBranchPadPlugin(plugins);
  return plg?.config?.branchPads && typeof plg.config.branchPads === "object"
    ? plg.config.branchPads
    : {};
}

export function getUserPadMap(
  plugins: SitePlugin[]
): Record<string, BranchPadConfig> {
  const plg = getBranchPadPlugin(plugins);
  return plg?.config?.userPads && typeof plg.config.userPads === "object"
    ? plg.config.userPads
    : {};
}

export function resolveUserPad(
  plugins: SitePlugin[],
  userId?: string
): BranchPadConfig | null {
  if (!userId || !userId.trim()) return null;
  if (!isBranchPadPluginEnabled(plugins)) return null;
  const userMap = getUserPadMap(plugins);
  const pad = userMap[userId.trim()];
  if (!pad || pad.enabled === false) return null;
  return pad;
}

export function resolveBranchPadForDepartment(
  plugins: SitePlugin[],
  departmentName?: string
): BranchPadConfig | null {
  if (
    !departmentName ||
    departmentName === "__default__" ||
    departmentName === "সকল বিভাগ"
  ) {
    return null;
  }
  if (!isBranchPadPluginEnabled(plugins)) return null;
  const map = getBranchPadMap(plugins);
  const pad = map[departmentName];
  if (!pad || pad.enabled === false) return null;
  return pad;
}

export function resolveActivePadForUser(params: {
  plugins: SitePlugin[];
  userId?: string;
  preferredDepartment?: string;
  userDepartment?: string;
}): { scopeKey?: string; config: BranchPadConfig | null } {
  const { plugins, userId, preferredDepartment, userDepartment } = params;
  if (!isBranchPadPluginEnabled(plugins)) {
    return { config: null };
  }

  const userPad = resolveUserPad(plugins, userId);
  if (userPad && userId) {
    return { scopeKey: makeUserPadKey(userId), config: userPad };
  }

  if (preferredDepartment) {
    const prefPad = resolveBranchPadForDepartment(plugins, preferredDepartment);
    if (prefPad) {
      return { scopeKey: preferredDepartment, config: prefPad };
    }
  }

  if (userDepartment && userDepartment !== "সকল বিভাগ") {
    const deptPad = resolveBranchPadForDepartment(plugins, userDepartment);
    if (deptPad) {
      return { scopeKey: userDepartment, config: deptPad };
    }
  }

  return { config: null };
}

export function resolveBranchPadForLetter(params: {
  plugins: SitePlugin[];
  letter: LetterData | SavedLetter;
  templates?: LetterTemplate[];
  userDepartment?: string;
  currentUserId?: string;
}): {
  departmentName: string;
  isUserPad?: boolean;
  userId?: string;
  config: BranchPadConfig;
} | null {
  const {
    plugins,
    letter,
    templates = [],
    userDepartment,
    currentUserId,
  } = params;
  if (!isBranchPadPluginEnabled(plugins)) return null;
  if (letter.branchPadDepartment === "__default__") return null;

  const map = getBranchPadMap(plugins);
  const userMap = getUserPadMap(plugins);

  const explicit = letter.branchPadDepartment?.trim();
  if (explicit) {
    const explicitUid = parseUserPadKey(explicit);
    if (explicitUid) {
      const up = userMap[explicitUid];
      if (up && up.enabled !== false) {
        return {
          departmentName: up.branchTitleBn || explicitUid,
          isUserPad: true,
          userId: explicitUid,
          config: up,
        };
      }
    } else {
      const bp = map[explicit];
      if (bp && bp.enabled !== false) {
        return { departmentName: explicit, config: bp };
      }
    }
  }

  const letterOwnerUid =
    ("ownerUserId" in letter && letter.ownerUserId) || currentUserId;
  if (letterOwnerUid) {
    const ownerPad = userMap[letterOwnerUid];
    if (ownerPad && ownerPad.enabled !== false) {
      return {
        departmentName: ownerPad.branchTitleBn || letterOwnerUid,
        isUserPad: true,
        userId: letterOwnerUid,
        config: ownerPad,
      };
    }
  }

  const candidates: string[] = [];
  const matchedTemplate = templates.find(
    (t) => t.title === letter.templateType
  );
  if (matchedTemplate?.category) {
    candidates.push(matchedTemplate.category);
  }
  if ("department" in letter && letter.department) {
    candidates.push(letter.department);
  }
  if (userDepartment && userDepartment !== "সকল বিভাগ") {
    candidates.push(userDepartment);
  }

  for (const dept of candidates) {
    const pad = map[dept];
    if (pad && pad.enabled !== false) {
      return { departmentName: dept, config: pad };
    }
  }

  return null;
}

export function createDefaultBranchPadConfig(
  labelOrName: string,
  org: OrganizationProfile,
  options?: {
    isUserPad?: boolean;
    userFullName?: string;
    userDesignation?: string;
    userDepartment?: string;
  }
): BranchPadConfig {
  const isUser = Boolean(options?.isUserPad);
  const displayTitle = isUser
    ? options?.userDepartment && options.userDepartment !== "সকল বিভাগ"
      ? options.userDepartment
      : labelOrName
    : labelOrName;
  const sigName = isUser ? options?.userFullName || "" : "";
  const sigTitle = isUser
    ? options?.userDesignation || "দায়িত্বপ্রাপ্ত কর্মকর্তা"
    : "শাখা কর্মকর্তা";
  const sigDept = isUser
    ? options?.userDepartment || org.defaultSignatoryDept
    : labelOrName;

  return {
    enabled: true,
    branchTitleBn: displayTitle,
    orgNameOverride: "",
    nameEnOverride: "",
    headerTagline: "",
    regNumber: "",
    address: "",
    phone: "",
    email: "",
    website: "",
    refPrefix: org.refPrefix || "মডেঅ/শাখা",
    accentColor: org.brandColor || "#1E3A8A",
    crestType: org.crestType || "corporate",
    letterheadStyle: "classic",
    letterFont: "sutonnymj",
    logoUrl: "",
    footerNote: "",
    signatories: isUser
      ? [
          {
            id: `sig-${Date.now()}-1`,
            roleLabel: "স্বাক্ষরকারী",
            name: sigName || org.defaultSignatoryName || "",
            title: sigTitle || org.defaultSignatoryTitle || "",
            department: sigDept,
            signatureUrl: "",
          },
        ]
      : [
          {
            id: `sig-${Date.now()}-1`,
            roleLabel: "প্রস্তুতকারী",
            name: "",
            title: "শাখা কর্মকর্তা",
            department: labelOrName,
            signatureUrl: "",
          },
          {
            id: `sig-${Date.now()}-2`,
            roleLabel: "অনুমোদনকারী",
            name: org.defaultSignatoryName || "",
            title: org.defaultSignatoryTitle || "শাখা ব্যবস্থাপক",
            department: labelOrName,
            signatureUrl: "",
          },
        ],
  };
}
