const BENGALI_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

export function toBengaliDigits(value: string | number): string {
  return String(value).replace(/\d/g, (digit) => BENGALI_DIGITS[Number(digit)] ?? digit);
}

const GREGORIAN_MONTHS_BN = [
  "জানুয়ারি",
  "ফেব্রুয়ারি",
  "মার্চ",
  "এপ্রিল",
  "মে",
  "জুন",
  "জুলাই",
  "আগস্ট",
  "সেপ্টেম্বর",
  "অক্টোবর",
  "নভেম্বর",
  "ডিসেম্বর",
];

export function formatBengaliDate(date: Date = new Date()): string {
  const day = toBengaliDigits(date.getDate());
  const month = GREGORIAN_MONTHS_BN[date.getMonth()];
  const year = toBengaliDigits(date.getFullYear());
  return `${day} ${month} ${year}`;
}

export function formatBengaliTime(date: Date = new Date()): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return toBengaliDigits(`${h}:${m}:${s}`);
}

const BANGLA_MONTHS = [
  "বৈশাখ",
  "জ্যৈষ্ঠ",
  "আষাঢ়",
  "শ্রাবণ",
  "ভাদ্র",
  "আশ্বিন",
  "কার্তিক",
  "অগ্রহায়ণ",
  "পৌষ",
  "মাঘ",
  "ফাল্গুন",
  "চৈত্র",
];

export function formatBanglaCalendarDate(date: Date = new Date()): string {
  const gYear = date.getFullYear();
  const gStartOfYear = new Date(gYear, 3, 14);

  let bYear = gYear - 593;
  let refBoishakh = gStartOfYear;

  if (date < gStartOfYear) {
    bYear -= 1;
    refBoishakh = new Date(gYear - 1, 3, 14);
  }

  const diffDays = Math.floor((date.getTime() - refBoishakh.getTime()) / (1000 * 60 * 60 * 24));
  const nextFebLeapYear = bYear + 594;
  const isBanglaLeap =
    (nextFebLeapYear % 4 === 0 && nextFebLeapYear % 100 !== 0) || nextFebLeapYear % 400 === 0;

  const monthLengths = [
    31, 31, 31, 31, 31, 31, 30, 30, 30, 30,
    isBanglaLeap ? 30 : 29,
    30,
  ];

  let remaining = diffDays;
  let monthIndex = 0;

  for (let i = 0; i < monthLengths.length; i++) {
    if (remaining < monthLengths[i]) {
      monthIndex = i;
      break;
    }
    remaining -= monthLengths[i];
    if (i === monthLengths.length - 1) {
      monthIndex = 11;
    }
  }

  const bDay = remaining + 1;
  return `${toBengaliDigits(bDay)} ${BANGLA_MONTHS[monthIndex]} ${toBengaliDigits(bYear)} বঙ্গাব্দ`;
}

export function generateNextRefNumber(prefix: string, suffix: string, seq?: number): string {
  const cleanPrefix = prefix.trim().replace(/\/+$/, "");
  const cleanSuffix = suffix.trim().replace(/^\/+/, "");
  const yearBn = toBengaliDigits(new Date().getFullYear());
  const serial = seq ?? Math.floor(100 + Math.random() * 899);
  const serialBn = toBengaliDigits(serial);
  if (cleanSuffix) {
    return `${cleanPrefix}/${yearBn}/${cleanSuffix}/${serialBn}`;
  }
  return `${cleanPrefix}/${yearBn}/${serialBn}`;
}
