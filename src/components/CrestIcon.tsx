import React from "react";
import { CrestType } from "../types";

interface CrestIconProps {
  type: CrestType;
  color: string;
  size?: number;
  className?: string;
}

export const CrestIcon: React.FC<CrestIconProps> = ({
  type,
  color,
  size = 48,
  className = "",
}) => {
  switch (type) {
    case "academic":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 64 64"
          fill="none"
          className={className}
          aria-hidden="true"
        >
          <path
            d="M32 6L54 14V30C54 44.5 44.2 54.4 32 58C19.8 54.4 10 44.5 10 30V14L32 6Z"
            stroke={color}
            strokeWidth="2.2"
          />
          <path
            d="M32 11L49 17.5V29.5C49 41 41.4 49 32 52.3C22.6 49 15 41 15 29.5V17.5L32 11Z"
            stroke={color}
            strokeWidth="1"
            strokeOpacity="0.45"
          />
          <path
            d="M21 27.5L32 22L43 27.5L32 33L21 27.5Z"
            stroke={color}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M25 30V38C25 38 28.5 41 32 41C35.5 41 39 38 39 38V30"
            stroke={color}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <line x1="43" y1="27.5" x2="43" y2="36" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );

    case "corporate":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 64 64"
          fill="none"
          className={className}
          aria-hidden="true"
        >
          <rect x="8" y="8" width="48" height="48" rx="4" stroke={color} strokeWidth="2.2" />
          <path d="M18 44V24L32 16L46 24V44" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          <path d="M26 44V31H38V44" stroke={color} strokeWidth="2" />
          <line x1="14" y1="44" x2="50" y2="44" stroke={color} strokeWidth="2" strokeLinecap="round" />
          <circle cx="32" cy="24" r="2.2" fill={color} />
        </svg>
      );

    case "justice":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 64 64"
          fill="none"
          className={className}
          aria-hidden="true"
        >
          <circle cx="32" cy="32" r="24" stroke={color} strokeWidth="2" />
          <circle cx="32" cy="32" r="20" stroke={color} strokeWidth="1" strokeDasharray="3 3" />
          <line x1="32" y1="15" x2="32" y2="47" stroke={color} strokeWidth="2" strokeLinecap="round" />
          <line x1="22" y1="47" x2="42" y2="47" stroke={color} strokeWidth="2" strokeLinecap="round" />
          <line x1="18" y1="22" x2="46" y2="22" stroke={color} strokeWidth="2" strokeLinecap="round" />
          <path d="M18 22L14 33H22L18 22Z" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M46 22L42 33H50L46 22Z" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      );

    case "tech":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 64 64"
          fill="none"
          className={className}
          aria-hidden="true"
        >
          <polygon
            points="32,7 54,19.5 54,44.5 32,57 10,44.5 10,19.5"
            stroke={color}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <polygon
            points="32,16 46,24 46,40 32,48 18,40 18,24"
            stroke={color}
            strokeWidth="1.5"
            strokeOpacity="0.6"
          />
          <circle cx="32" cy="32" r="5" fill={color} />
          <line x1="32" y1="16" x2="32" y2="27" stroke={color} strokeWidth="1.6" />
          <line x1="32" y1="37" x2="32" y2="48" stroke={color} strokeWidth="1.6" />
        </svg>
      );

    case "civic":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 64 64"
          fill="none"
          className={className}
          aria-hidden="true"
        >
          <circle cx="32" cy="32" r="24" stroke={color} strokeWidth="2.2" />
          <path
            d="M16 38C21 31 26 28 32 28C38 28 43 31 48 38"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M32 14C32 14 25 22 25 29C25 32.8 28.1 36 32 36C35.9 36 39 32.8 39 29C39 22 32 14 32 14Z"
            stroke={color}
            strokeWidth="1.8"
          />
          <line x1="20" y1="44" x2="44" y2="44" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );

    case "heritage":
    default:
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 64 64"
          fill="none"
          className={className}
          aria-hidden="true"
        >
          <circle cx="32" cy="32" r="24" stroke={color} strokeWidth="2.2" />
          <circle cx="32" cy="32" r="19.5" stroke={color} strokeWidth="1" strokeOpacity="0.5" />
          <path
            d="M32 15C29 21 27 26 27 31C27 34.5 29.2 37.5 32 38.5C34.8 37.5 37 34.5 37 31C37 26 35 21 32 15Z"
            stroke={color}
            strokeWidth="1.8"
          />
          <path
            d="M27 33C22 31 18 26 18 22C22 22 26 25 27.5 29"
            stroke={color}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M37 33C42 31 46 26 46 22C42 22 38 25 36.5 29"
            stroke={color}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M21 43H43" stroke={color} strokeWidth="2" strokeLinecap="round" />
          <path d="M25 47H39" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
};
