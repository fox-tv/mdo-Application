import type {
  BranchPadConfig,
  LetterData,
  LetterTemplate,
  OrganizationProfile,
  SavedLetter,
  SitePlugin,
} from "../types";

export function getBranchPadPlugin(
  plugins: SitePlugin[]
): SitePlugin | undefined {
  return plugins.find((p) => p.type === "branch-pad-designer");
}

export function isBranchPadPluginEnabled(plugins: SitePlugin[]): boolean {
  const plg = getBranchPadPlugin(plugins);
  return plg ? plg.enabled : false;
}

export function getBranchPadMap(
  plugins: SitePlugin[]
): Record<string, BranchPadConfig> {
  const plg = getBranchPadPlugin(plugins);
  return plg?.config?.branchPads && typeof plg.config.branchPads === "object"
    ? plg.config.branchPads
    : {};
}

export function resolveBranchPadForDepartment(
  plugins: SitePlugin[],
  departmentName?: string
): BranchPadConfig | null {
  if (!departmentName || departmentName === "__default__" || departmentName === "সকল বিভাগ") {
    return null;
  }
  if (!isBranchPadPluginEnabled(plugins)) return null;
  const map = getBranchPadMap(plugins);
  const pad = map[departmentName];
  if (!pad || pad.enabled === false) return null;
  return pad;
}

export function resolveBranchPadForLetter(params: {
  plugins: SitePlugin[];
  letter: LetterData | SavedLetter;
  templates?: LetterTemplate[];
  userDepartment?: string;
}): { departmentName: string; config: BranchPadConfig } | null {
  const { plugins, letter, templates = [], userDepartment } = params;
  if (!isBranchPadPluginEnabled(plugins)) return null;
  if (letter.branchPadDepartment === "__default__") return null;

  const map = getBranchPadMap(plugins);

  const candidates: string[] = [];
  if (letter.branchPadDepartment && letter.branchPadDepartment.trim()) {
    candidates.push(letter.branchPadDepartment.trim());
  }
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
  departmentName: string,
  org: OrganizationProfile
): BranchPadConfig {
  return {
    enabled: true,
    branchTitleBn: departmentName,
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
    signatories: [
      {
        id: `sig-${Date.now()}-1`,
        roleLabel: "প্রস্তুতকারী",
        name: "",
        title: "শাখা কর্মকর্তা",
        department: departmentName,
        signatureUrl: "",
      },
      {
        id: `sig-${Date.now()}-2`,
        roleLabel: "অনুমোদনকারী",
        name: org.defaultSignatoryName || "",
        title: org.defaultSignatoryTitle || "শাখা ব্যবস্থাপক",
        department: departmentName,
        signatureUrl: "",
      },
    ],
  };
}
