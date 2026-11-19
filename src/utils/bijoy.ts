/**
 * Converts Unicode Bengali text into Bijoy (SutonnyMJ ANSI) glyph encoding
 * so exported MS Word (.doc) and MS Excel (.xls) documents open directly in
 * genuine SutonnyMJ font on Windows office systems.
 */

const INDEPENDENT_VOWELS: Record<string, string> = {
  "\u0985": "A", // অ
  "\u0986": "Av", // আ
  "\u0987": "B", // ই
  "\u0988": "C", // ঈ
  "\u0989": "D", // উ
  "\u098A": "E", // ঊ
  "\u098B": "F", // ঋ
  "\u098F": "G", // এ
  "\u0990": "H", // ঐ
  "\u0993": "I", // ও
  "\u0994": "J", // ঔ
};

const CONSONANTS: Record<string, string> = {
  "\u0995": "K", // ক
  "\u0996": "L", // খ
  "\u0997": "M", // গ
  "\u0998": "N", // ঘ
  "\u0999": "O", // ঙ
  "\u099A": "P", // চ
  "\u099B": "Q", // ছ
  "\u099C": "R", // জ
  "\u099D": "S", // ঝ
  "\u099E": "T", // ঞ
  "\u099F": "U", // ট
  "\u09A0": "V", // ঠ
  "\u09A1": "W", // ড
  "\u09A2": "X", // ঢ
  "\u09A3": "Y", // ণ
  "\u09A4": "Z", // ত
  "\u09A5": "_", // থ
  "\u09A6": "`", // দ
  "\u09A7": "a", // ধ
  "\u09A8": "b", // ন
  "\u09AA": "c", // প
  "\u09AB": "d", // ফ
  "\u09AC": "e", // ব
  "\u09AD": "f", // ভ
  "\u09AE": "g", // ম
  "\u09AF": "h", // য
  "\u09B0": "i", // র
  "\u09B2": "j", // ল
  "\u09B6": "k", // শ
  "\u09B7": "l", // ষ
  "\u09B8": "m", // স
  "\u09B9": "n", // হ
  "\u09DC": "o", // ড়
  "\u09DD": "p", // ঢ়
  "\u09DF": "q", // য়
};

const MODIFIERS: Record<string, string> = {
  "\u09CE": "r", // ৎ
  "\u0982": "s", // ং
  "\u0983": "t", // ঃ
  "\u0981": "u", // ঁ
};

const DIGITS_AND_PUNCT: Record<string, string> = {
  "\u09E6": "0",
  "\u09E7": "1",
  "\u09E8": "2",
  "\u09E9": "3",
  "\u09EA": "4",
  "\u09EB": "5",
  "\u09EC": "6",
  "\u09ED": "7",
  "\u09EE": "8",
  "\u09EF": "9",
  "\u0964": "|", // ।
  "\u0965": "||", // ॥
  "\u09F3": "$", // ৳
  "\u2018": "Ô",
  "\u2019": "Õ",
  "\u201C": "Ò",
  "\u201D": "Ó",
  "\u2013": "-",
  "\u2014": "-",
};

const CONJUNCTS: Record<string, string> = {
  // 3-consonant common conjuncts
  "ক্ষ্ণ": "ÿè",
  "ক্ষ্ম": "²",
  "ঙ্ক": "¼",
  "ঙ্গ": "½",
  "জ্জ্ব": "¾",
  "ত্ত্ব": "Ë¡",
  "দ্দ্ব": "Ï¡",
  "দ্ধ্ব": "×¡",
  "ন্দ্ব": "›Ø",
  "ন্দ্র": "›`ª",
  "ন্ত্ব": "š—¡",
  "ন্ত্র": "š¿",
  "ম্প্র": "¤cÖ",
  "ম্ব্র": "¤eª",
  "স্ক্র": "¯µ",
  "স্ত্ব": "¯—¡",
  "স্ত্র": "¯¿",
  "স্প্র": "¯cÖ",
  "স্মৃ": "¯§„",
  // 2-consonant conjuncts
  "ক্ক": "°",
  "ক্ট": "±",
  "ক্ত": "³",
  "ক্ব": "K¡",
  "ক্ম": "K¥",
  "ক্র": "µ",
  "ক্ল": "K¬",
  "ক্ষ": "ÿ",
  "ক্স": "·",
  "গ্ধ": "»",
  "গ্ন": "Mœ",
  "গ্ব": "M¡",
  "গ্ম": "M¥",
  "গ্র": "MÖ",
  "গ্ল": "M¬",
  "ঙ্খ": "•L",
  "ঙ্ঘ": "•N",
  "ঙ্ম": "•g",
  "চ্চ": "”P",
  "চ্ছ": "”Q",
  "চ্ছ্ব": "”Q¡",
  "চ্ঞ": "”T",
  "জ্জ": "¾",
  "জ্ঝ": "À",
  "জ্ঞ": "Á",
  "জ্ব": "R¡",
  "জ্র": "Rª",
  "ঞ্চ": "Â",
  "ঞ্ছ": "Ã",
  "ঞ্জ": "Ä",
  "ঞ্ঝ": "Å",
  "ট্ট": "Æ",
  "ট্ব": "U¡",
  "ট্ম": "U¥",
  "ট্র": "Uª",
  "ড্ড": "Ç",
  "ড্র": "Wª",
  "ণ্ঠ": "É",
  "ণ্ড": "Ê",
  "ণ্ট": "È",
  "ণ্ণ": "Yœ",
  "ণ্ব": "Y¡",
  "ণ্ম": "Y¥",
  "ত্ত": "Ë",
  "ত্থ": "Ì",
  "ত্ন": "Zœ",
  "ত্ব": "Z¡",
  "ত্ম": "Z¥",
  "ত্র": "Î",
  "থ্ব": "_¡",
  "থ্র": "_ª",
  "দ্গ": "`M",
  "দ্ঘ": "`N",
  "দ্দ": "Ï",
  "দ্ধ": "×",
  "দ্ব": "Ø",
  "দ্ভ": "™¢",
  "দ্ম": "Ù",
  "দ্র": "`ª",
  "ধ্ব": "a¡",
  "ধ্ম": "a¥",
  "ধ্র": "aª",
  "ন্ট": "›U",
  "ন্ঠ": "›V",
  "ন্ড": "Û",
  "ন্ত": "š—",
  "ন্থ": "š’",
  "ন্দ": "›`",
  "ন্ধ": "Ü",
  "ন্ন": "bœ",
  "ন্ব": "b¡",
  "ন্ম": "b¥",
  "ন্স": "Ý",
  "প্ট": "Þ",
  "প্ত": "ß",
  "প্ন": "cœ",
  "প্প": "à",
  "প্র": "cÖ",
  "প্ল": "c¬",
  "প্স": "á",
  "ফ্ল": "d¬",
  "ফ্র": "dª",
  "ব্জ": "â",
  "ব্দ": "ã",
  "ব্ধ": "ä",
  "ব্ব": "eŸ",
  "ব্র": "eª",
  "ব্ল": "e¬",
  "ভ্র": "å",
  "ম্ন": "æ",
  "ম্প": "¤ú",
  "ম্ফ": "¤ù",
  "ম্ব": "¤^",
  "ম্ভ": "¤¢",
  "ম্ম": "¤§",
  "ম্র": "gª",
  "ম্ল": "g¬",
  "ল্ক": "é",
  "ল্গ": "ê",
  "ল্ট": "ë",
  "ল্ড": "ì",
  "ল্প": "í",
  "ল্ব": "j¡",
  "ল্ম": "j¥",
  "ল্ল": "jø",
  "শ্চ": "ð",
  "শ্ছ": "kQ",
  "শ্ন": "kœ",
  "শ্ব": "k¦",
  "শ্ম": "k¥",
  "শ্র": "kÖ",
  "শ্ল": "kø",
  "ষ্ক": "®‹",
  "ষ্ট": "ó",
  "ষ্ঠ": "ô",
  "ষ্ণ": "ò",
  "ষ্প": "®ú",
  "ষ্ফ": "®ù",
  "ষ্ব": "l¡",
  "ষ্ম": "®§",
  "স্ক": "¯‹",
  "স্খ": "¯L",
  "স্ট": "÷",
  "স্ত": "¯—",
  "স্থ": "¯’",
  "স্ন": "mœ",
  "স্প": "¯ú",
  "স্ফ": "ù",
  "স্ব": "¯^",
  "স্ম": "¯§",
  "স্র": "mª",
  "স্ল": "mø",
  "হ্ণ": "nè",
  "হ্ন": "ý",
  "হ্ব": "n¡",
  "হ্ম": "þ",
  "হ্ল": "n¬",
  "হ্র": "nª",
};

const SPECIAL_VOWEL_LIGATURES: Record<string, string> = {
  "গু": "¸",
  "শু": "ï",
  "হু": "û",
  "হৃ": "ü",
  "রু": "iæ",
  "রূ": "iƒ",
  "তু": "Zz",
  "ভু": "fz",
};

const PRE_MATRAS: Record<string, string> = {
  "\u09BF": "w", // ি
  "\u09C7": "†", // ে
  "\u09C8": "‰", // ৈ
};

const POST_MATRAS: Record<string, string> = {
  "\u09BE": "v", // া
  "\u09C0": "x", // ী
  "\u09C1": "y", // ু
  "\u09C2": "~", // ূ
  "\u09C3": "„", // ৃ
};

const SPLIT_MATRAS: Record<string, [string, string]> = {
  "\u09CB": ["†", "v"], // ো = ে + া
  "\u09CC": ["†", "Š"], // ৌ = ে + ৗ
};

const HASANTA = "\u09CD";

function isConsonant(ch: string): boolean {
  return ch in CONSONANTS;
}

function isMatra(ch: string): boolean {
  return ch in PRE_MATRAS || ch in POST_MATRAS || ch in SPLIT_MATRAS;
}

function mapConjunctCluster(cluster: string): string {
  // Strip ZWNJ/ZWJ
  const clean = cluster.replace(/[\u200C\u200D]/g, "");
  if (clean in CONJUNCTS) return CONJUNCTS[clean];

  // Handle trailing য-ফলা (্ + য)
  if (clean.endsWith(HASANTA + "\u09AF")) {
    const base = clean.slice(0, -2);
    return mapConjunctCluster(base) + "¨";
  }

  // Handle trailing ব-ফলা (্ + ব)
  if (clean.endsWith(HASANTA + "\u09AC")) {
    const base = clean.slice(0, -2);
    return mapConjunctCluster(base) + "¡";
  }

  // Handle trailing র-ফলা (্ + র)
  if (clean.endsWith(HASANTA + "\u09B0")) {
    const base = clean.slice(0, -2);
    const full = base + HASANTA + "\u09B0";
    if (full in CONJUNCTS) return CONJUNCTS[full];
    return mapConjunctCluster(base) + "ª";
  }

  // Fallback character by character
  let out = "";
  const chars = Array.from(clean);
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c in CONSONANTS) {
      out += CONSONANTS[c];
    } else if (c === HASANTA) {
      // Explicit hasanta if at end of cluster, otherwise skip
      if (i === chars.length - 1) out += "&";
    }
  }
  return out;
}

export function unicodeToBijoy(input: string): string {
  if (!input) return "";
  const text = input
    .normalize("NFC")
    .replace(/\u09A1\u09BC/g, "\u09DC")
    .replace(/\u09A2\u09BC/g, "\u09DD")
    .replace(/\u09AF\u09BC/g, "\u09DF")
    .replace(/\u200C|\u200D/g, "");

  const chars = Array.from(text);
  const len = chars.length;
  let result = "";
  let i = 0;

  while (i < len) {
    const ch = chars[i];

    // Check independent vowels, modifiers, digits, punctuation
    if (ch in INDEPENDENT_VOWELS) {
      if (i + 2 < len && chars[i + 1] === HASANTA && chars[i + 2] === "\u09AF") {
        result += INDEPENDENT_VOWELS[ch] + "¨";
        i += 3;
        continue;
      }
      result += INDEPENDENT_VOWELS[ch];
      i++;
      continue;
    }
    if (ch in MODIFIERS) {
      result += MODIFIERS[ch];
      i++;
      continue;
    }
    if (ch in DIGITS_AND_PUNCT) {
      result += DIGITS_AND_PUNCT[ch];
      i++;
      continue;
    }

    if (!isConsonant(ch)) {
      // Standalone matra or Latin/whitespace/punctuation
      if (ch in PRE_MATRAS) result += PRE_MATRAS[ch];
      else if (ch in POST_MATRAS) result += POST_MATRAS[ch];
      else if (ch in SPLIT_MATRAS) result += SPLIT_MATRAS[ch][0] + SPLIT_MATRAS[ch][1];
      else if (ch === HASANTA) result += "&";
      else result += ch;
      i++;
      continue;
    }

    // Check for Reph (র + ্ followed by another consonant)
    let hasReph = false;
    if (
      ch === "\u09B0" &&
      i + 2 < len &&
      chars[i + 1] === HASANTA &&
      isConsonant(chars[i + 2])
    ) {
      hasReph = true;
      i += 2;
    }

    // Collect consonant cluster: C (্ C)*
    let cluster = chars[i];
    i++;
    while (
      i + 1 < len &&
      chars[i] === HASANTA &&
      isConsonant(chars[i + 1])
    ) {
      // If a য-ফলা or ব-ফলা or র-ফলা, check if another ্ follows; keep full cluster together
      cluster += HASANTA + chars[i + 1];
      i += 2;
    }

    // Check trailing explicit hasanta (হসন্ত at end of syllable)
    let trailingHasanta = false;
    if (i < len && chars[i] === HASANTA && (i + 1 >= len || !isConsonant(chars[i + 1]))) {
      trailingHasanta = true;
      i++;
    }

    // Check attached vowel matra
    let matra = "";
    if (!trailingHasanta && i < len && isMatra(chars[i])) {
      matra = chars[i];
      i++;
    }

    // Check special single consonant + u/uu/ri ligature (গু, শু, হু, হৃ, রু, রূ, তু, ভু)
    const specialKey = cluster + matra;
    if (!hasReph && !trailingHasanta && specialKey in SPECIAL_VOWEL_LIGATURES) {
      result += SPECIAL_VOWEL_LIGATURES[specialKey];
      continue;
    }

    const mappedCluster = mapConjunctCluster(cluster) + (trailingHasanta ? "&" : "");
    const rephSuffix = hasReph ? "©" : "";

    if (!matra) {
      result += mappedCluster + rephSuffix;
    } else if (matra in PRE_MATRAS) {
      result += PRE_MATRAS[matra] + mappedCluster + rephSuffix;
    } else if (matra in POST_MATRAS) {
      result += mappedCluster + rephSuffix + POST_MATRAS[matra];
    } else if (matra in SPLIT_MATRAS) {
      const [pre, post] = SPLIT_MATRAS[matra];
      result += pre + mappedCluster + rephSuffix + post;
    }
  }

  return result;
}
