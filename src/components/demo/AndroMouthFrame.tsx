import { type ReactNode } from "react";
import "./andro-mouth-frame.css";

interface Props {
  children: ReactNode;
}

export function AndroMouthFrame({ children }: Props) {
  return (
    <div className="androHero">
      <div className="androStage">
        <svg
          className="androSvg"
          viewBox="0 0 1200 700"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          <defs>
            {/* Mouth opening matches the card container size/position */}
            <clipPath id="mouthClip">
              {/* This rounded-rect defines the mouth hole */}
              <rect x="270" y="250" width="660" height="260" rx="28" />
            </clipPath>

            {/* Mask: show face everywhere EXCEPT mouth opening */}
            <mask id="mouthMask">
              <rect width="1200" height="700" fill="white" />
              <rect x="270" y="250" width="660" height="260" rx="28" fill="black" />
            </mask>

            <linearGradient id="faceGradMouth" x1="600" y1="0" x2="600" y2="700" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.18" />
              <stop offset="50%" stopColor="hsl(var(--primary))" stopOpacity="0.10" />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.04" />
            </linearGradient>

            <filter id="faceDropShadow">
              <feDropShadow dx="0" dy="6" stdDeviation="18" floodColor="hsl(var(--primary))" floodOpacity="0.15" />
            </filter>

            <filter id="rimGlow">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>

            <filter id="eyeGlowMouth">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>

            <radialGradient id="antennaGlowMouth" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.5" />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* ── Head blob (behind), with the mouth hole cut out ── */}
          <g mask="url(#mouthMask)" filter="url(#faceDropShadow)">
            {/* Head shape — wide oval */}
            <ellipse
              cx="600" cy="350"
              rx="480" ry="320"
              fill="url(#faceGradMouth)"
              stroke="hsl(var(--primary))"
              strokeWidth="2"
              strokeOpacity="0.22"
            />

            {/* Eyes (subtle, behind) */}
            <ellipse
              cx="400" cy="190"
              rx="42" ry="28"
              fill="hsl(var(--primary))" fillOpacity="0.06"
              stroke="hsl(var(--primary))" strokeWidth="1.5" strokeOpacity="0.18"
              filter="url(#eyeGlowMouth)"
            />
            <circle cx="400" cy="190" r="14" fill="hsl(var(--primary))" fillOpacity="0.15" />
            <circle cx="400" cy="190" r="6" fill="hsl(var(--primary))" fillOpacity="0.3" />

            <ellipse
              cx="800" cy="190"
              rx="42" ry="28"
              fill="hsl(var(--primary))" fillOpacity="0.06"
              stroke="hsl(var(--primary))" strokeWidth="1.5" strokeOpacity="0.18"
              filter="url(#eyeGlowMouth)"
            />
            <circle cx="800" cy="190" r="14" fill="hsl(var(--primary))" fillOpacity="0.15" />
            <circle cx="800" cy="190" r="6" fill="hsl(var(--primary))" fillOpacity="0.3" />

            {/* Antenna */}
            <line
              x1="600" y1="35" x2="600" y2="8"
              stroke="hsl(var(--primary))" strokeWidth="2.5" strokeOpacity="0.35" strokeLinecap="round"
            />
            <circle cx="600" cy="6" r="14" fill="url(#antennaGlowMouth)" />
            <circle cx="600" cy="6" r="5" fill="hsl(var(--primary))" fillOpacity="0.4" />
          </g>

          {/* ── FRONT MOUTH RIM (must overlap the card edges) ── */}
          <g filter="url(#rimGlow)">
            {/* Outer rim */}
            <rect
              x="262" y="242" width="676" height="276" rx="32"
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="3"
              strokeOpacity="0.25"
            />
            {/* Inner rim shadow */}
            <rect
              x="268" y="248" width="664" height="264" rx="29"
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="1"
              strokeOpacity="0.10"
            />
            {/* Teeth highlight (top) */}
            <line
              x1="320" y1="252" x2="880" y2="252"
              stroke="hsl(var(--primary))"
              strokeWidth="2"
              strokeOpacity="0.12"
              strokeLinecap="round"
            />
            {/* Chin highlight (bottom) */}
            <path
              d="M 400 518 Q 600 560, 800 518"
              stroke="hsl(var(--primary))"
              strokeWidth="2.5"
              strokeOpacity="0.18"
              fill="none"
              strokeLinecap="round"
            />
          </g>

          {/* Ear accents */}
          <path
            d="M 125 280 Q 95 350, 110 420"
            stroke="hsl(var(--primary))" strokeWidth="1.5" strokeOpacity="0.12"
            fill="none" strokeLinecap="round"
          />
          <path
            d="M 1075 280 Q 1105 350, 1090 420"
            stroke="hsl(var(--primary))" strokeWidth="1.5" strokeOpacity="0.12"
            fill="none" strokeLinecap="round"
          />
        </svg>

        {/* CARD goes INSIDE mouth opening */}
        <div className="mouthCardSlot">
          {children}
        </div>
      </div>
    </div>
  );
}
