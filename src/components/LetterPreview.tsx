import React, { useLayoutEffect, useRef } from "react";
import { LetterData, OrganizationProfile } from "../types";
import { CrestIcon } from "./CrestIcon";

interface LetterPreviewProps {
  letter: LetterData;
  org: OrganizationProfile;
  exportRef?: React.RefObject<HTMLDivElement | null>;
  autoFitOnePage?: boolean;
  onFitScaleChange?: (scale: number) => void;
}

export const LetterPreview: React.FC<LetterPreviewProps> = ({
  letter,
  org,
  exportRef,
  autoFitOnePage = true,
  onFitScaleChange,
}) => {
  const brandColor = org.brandColor || "#1E3A8A";
  const fontClass =
    letter.letterFont === "serif" ? "font-letter-serif" : "font-letter-sans";

  const sheetRef = useRef<HTMLDivElement | null>(null);
  const scaleBoxRef = useRef<HTMLDivElement | null>(null);
  const topSectionRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLElement | null>(null);

  const bodyParagraphs = letter.body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const attachmentLines = letter.attachments
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const ccLines = letter.ccList
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  useLayoutEffect(() => {
    const sheetEl = sheetRef.current;
    const scaleEl = scaleBoxRef.current;
    const topEl = topSectionRef.current;
    const footerEl = footerRef.current;
    if (!sheetEl || !scaleEl || !topEl || !footerEl) return;

    // Reset to unscaled 100% first for deterministic measurement before paint
    scaleEl.style.width = "100%";
    scaleEl.style.height = "100%";
    scaleEl.style.transform = "none";

    if (!autoFitOnePage) {
      onFitScaleChange?.(1);
      return;
    }

    const style = window.getComputedStyle(sheetEl);
    const padTop = parseFloat(style.paddingTop) || 0;
    const padBottom = parseFloat(style.paddingBottom) || 0;
    const availableHeight = sheetEl.clientHeight - padTop - padBottom;

    // 16px buffer between main body and footer
    const naturalHeight = topEl.offsetHeight + footerEl.offsetHeight + 16;

    if (availableHeight > 0 && naturalHeight > availableHeight) {
      const s = Math.max(
        0.62,
        Math.floor((availableHeight / naturalHeight) * 992) / 1000
      );
      scaleEl.style.width = `${100 / s}%`;
      scaleEl.style.height = `${100 / s}%`;
      scaleEl.style.transform = `scale(${s})`;
      onFitScaleChange?.(s);
    } else {
      onFitScaleChange?.(1);
    }
  }, [autoFitOnePage, letter, org, onFitScaleChange]);

  const renderLogoOrCrest = (size = 62) => {
    if (org.logoDataUrl) {
      return (
        <img
          src={org.logoDataUrl}
          alt={org.nameBn}
          referrerPolicy="no-referrer"
          style={{ width: size, height: size, objectFit: "contain" }}
          className="shrink-0"
        />
      );
    }
    return <CrestIcon type={org.crestType} color={brandColor} size={size} />;
  };

  return (
    <div
      ref={(node) => {
        sheetRef.current = node;
        if (exportRef) {
          exportRef.current = node;
        }
      }}
      className={`a4-sheet relative bg-white text-[#1C1917] ${fontClass} mx-auto overflow-hidden`}
      style={{
        width: "210mm",
        height: "297mm",
        padding: letter.letterheadStyle === "archival" ? "13mm 17mm" : "14mm 18mm",
        boxSizing: "border-box",
      }}
    >
      {/* Archival outer thin frame */}
      {letter.letterheadStyle === "archival" && (
        <div
          className="pointer-events-none absolute inset-[7mm] border"
          style={{ borderColor: `${brandColor}40` }}
          aria-hidden="true"
        />
      )}

      {/* Modern top accent strip */}
      {letter.letterheadStyle === "modern" && (
        <div
          className="absolute top-0 left-0 right-0 h-[4mm]"
          style={{ backgroundColor: brandColor }}
          aria-hidden="true"
        />
      )}

      {/* Scaled Single-Page Content Container */}
      <div
        ref={scaleBoxRef}
        className="flex flex-col justify-between"
        style={{
          width: "100%",
          height: "100%",
          transformOrigin: "top left",
        }}
      >
        <div ref={topSectionRef}>
          {/* LETTERHEAD HEADER */}
          {letter.letterheadStyle === "modern" ? (
            <header className="pt-1 pb-3 border-b border-stone-300 flex items-start justify-between gap-5">
              <div className="flex items-center gap-3.5">
                {letter.showWatermark && renderLogoOrCrest(62)}
                <div>
                  <h1
                    className="text-[20pt] font-bold leading-tight tracking-tight"
                    style={{ color: brandColor }}
                  >
                    {org.nameBn || "প্রতিষ্ঠানের নাম"}
                  </h1>
                  {org.nameEn && (
                    <p className="text-[8pt] tracking-[0.14em] uppercase text-stone-500 mt-0.5 font-ui">
                      {org.nameEn}
                    </p>
                  )}
                  {org.tagline && (
                    <p className="text-[9pt] text-stone-600 mt-0.5">{org.tagline}</p>
                  )}
                </div>
              </div>
              <div className="text-right text-[8.5pt] text-stone-600 leading-snug max-w-[66mm] font-ui">
                {org.address && <p>{org.address}</p>}
                {org.phone && <p className="tabular-nums">ফোন: {org.phone}</p>}
                {org.email && <p>{org.email}</p>}
                {org.regNumber && (
                  <p className="text-stone-500 mt-0.5">{org.regNumber}</p>
                )}
              </div>
            </header>
          ) : (
            <header className="pb-2.5 text-center">
              <div className="flex flex-col items-center">
                {letter.showWatermark && (
                  <div className="mb-1.5">{renderLogoOrCrest(62)}</div>
                )}
                <h1
                  className="text-[21pt] font-bold leading-tight"
                  style={{ color: brandColor }}
                >
                  {org.nameBn || "প্রতিষ্ঠানের নাম"}
                </h1>
                {org.nameEn && (
                  <p className="text-[8pt] tracking-[0.16em] uppercase text-stone-500 mt-0.5 font-ui">
                    {org.nameEn}
                  </p>
                )}
                {org.tagline && (
                  <p className="text-[9.5pt] text-stone-700 mt-0.5">{org.tagline}</p>
                )}
                <div className="mt-1 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-0.5 text-[8.5pt] text-stone-600 font-ui">
                  {org.address && <span>{org.address}</span>}
                  {org.regNumber && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{org.regNumber}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="mt-2.5">
                <div
                  className="h-[1.5px] w-full"
                  style={{ backgroundColor: brandColor }}
                />
                <div
                  className="h-[0.75px] w-full mt-[2px]"
                  style={{ backgroundColor: `${brandColor}66` }}
                />
              </div>
            </header>
          )}

          {/* REFERENCE NUMBER & DATE ROW */}
          <div className="mt-3 flex items-start justify-between gap-4 text-[10pt]">
            <div className="tabular-nums">
              <span className="font-semibold text-stone-800">স্মারক নং: </span>
              <span className="text-stone-900">{letter.refNumber || "—"}</span>
            </div>
            <div className="text-right tabular-nums">
              <div>
                <span className="font-semibold text-stone-800">তারিখ: </span>
                <span className="text-stone-900">{letter.dateText}</span>
              </div>
              {letter.showBanglaDate && letter.banglaDateText && (
                <div className="text-[8.5pt] text-stone-600">
                  {letter.banglaDateText}
                </div>
              )}
            </div>
          </div>

          {/* RECIPIENT BLOCK */}
          {(letter.recipientName ||
            letter.recipientTitle ||
            letter.recipientOrg ||
            letter.recipientAddress) && (
            <div className="mt-4 text-[10.5pt] leading-[1.5] text-stone-900">
              {letter.recipientPrefix && (
                <p className="font-semibold text-stone-800">
                  {letter.recipientPrefix},
                </p>
              )}
              {letter.recipientName && (
                <p className="font-medium">{letter.recipientName}</p>
              )}
              {letter.recipientTitle && <p>{letter.recipientTitle}</p>}
              {letter.recipientOrg && <p>{letter.recipientOrg}</p>}
              {letter.recipientAddress && <p>{letter.recipientAddress}</p>}
            </div>
          )}

          {/* SUBJECT LINE */}
          {letter.subject && (
            <div className="mt-4 text-[11pt] leading-[1.45] text-stone-950">
              <span className="font-bold">বিষয়: </span>
              <span className="font-bold underline decoration-stone-400 underline-offset-4">
                {letter.subject}
              </span>
            </div>
          )}

          {/* SALUTATION */}
          {letter.salutation && (
            <div className="mt-3.5 text-[10.5pt] text-stone-900">
              {letter.salutation}
            </div>
          )}

          {/* MAIN LETTER BODY */}
          <div className="mt-2.5 space-y-2.5 text-[10.5pt] leading-[1.68] text-stone-900 text-justify">
            {bodyParagraphs.length > 0 ? (
              bodyParagraphs.map((para, idx) => (
                <p key={idx} className="whitespace-pre-line">
                  {para}
                </p>
              ))
            ) : (
              <p className="text-stone-400 italic">
                এখানে আপনার চিঠির মূল বক্তব্য প্রদর্শিত হবে...
              </p>
            )}
          </div>

          {/* CLOSING & SIGNATURE BLOCK */}
          <div className="mt-6 flex items-end justify-between gap-8">
            <div>
              {letter.showSealPlaceholder && (
                <div className="w-[32mm] h-[18mm] border border-dashed border-stone-300 flex items-center justify-center text-[8pt] text-stone-400 font-ui">
                  প্রতিষ্ঠানের সীল
                </div>
              )}
            </div>

            <div className="min-w-[54mm] text-center">
              {letter.closing && (
                <p className="text-[10pt] text-stone-800 mb-2 text-left">
                  {letter.closing}
                </p>
              )}
              <div className="h-[12mm] flex items-end justify-center mb-1">
                {org.signatureDataUrl ? (
                  <img
                    src={org.signatureDataUrl}
                    alt="স্বাক্ষর"
                    referrerPolicy="no-referrer"
                    className="max-h-[12mm] max-w-[42mm] object-contain"
                  />
                ) : (
                  <div className="w-36 border-b border-stone-400" />
                )}
              </div>
              {letter.signatoryName && (
                <p className="text-[10.5pt] font-bold text-stone-950">
                  {letter.signatoryName}
                </p>
              )}
              {letter.signatoryTitle && (
                <p className="text-[9pt] text-stone-700">{letter.signatoryTitle}</p>
              )}
              {letter.signatoryDept && (
                <p className="text-[8.5pt] text-stone-600">{letter.signatoryDept}</p>
              )}
              {org.nameBn && (
                <p className="text-[8.5pt] font-medium text-stone-700 mt-0.5">
                  {org.nameBn}
                </p>
              )}
            </div>
          </div>

          {/* ATTACHMENTS & CC */}
          {(attachmentLines.length > 0 || ccLines.length > 0) && (
            <div className="mt-5 pt-2.5 border-t border-stone-200 grid grid-cols-1 gap-2 text-[9pt] leading-snug text-stone-700">
              {attachmentLines.length > 0 && (
                <div>
                  <p className="font-bold text-stone-900 mb-0.5">সংযুক্তি:</p>
                  {attachmentLines.map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              )}
              {ccLines.length > 0 && (
                <div>
                  <p className="font-bold text-stone-900 mb-0.5">
                    অনুলিপি সদয় অবগতি ও প্রয়োজনীয় ব্যবস্থা গ্রহণের জন্য:
                  </p>
                  {ccLines.map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* LETTERHEAD FOOTER */}
        <footer
          ref={footerRef}
          className="mt-4 pt-2 border-t border-stone-200 flex flex-wrap items-center justify-between gap-2 text-[8pt] text-stone-500 font-ui"
        >
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
            {org.phone && <span className="tabular-nums">ফোন: {org.phone}</span>}
            {org.email && (
              <>
                <span aria-hidden="true">·</span>
                <span>ইমেইল: {org.email}</span>
              </>
            )}
            {org.website && (
              <>
                <span aria-hidden="true">·</span>
                <span>ওয়েব: {org.website}</span>
              </>
            )}
          </div>
          <span className="tabular-nums text-stone-400">
            স্মারক: {letter.refNumber}
          </span>
        </footer>
      </div>
    </div>
  );
};
