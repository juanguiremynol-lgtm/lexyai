/**
 * AndroDemoFrame — Wraps the demo lookup module inside a stylized
 * Andro IA mascot face silhouette. The face acts as a visual frame
 * with a "visor" cutout where the demo content sits.
 *
 * Uses inline SVG with themed gradients for visibility on dark backgrounds.
 * Respects prefers-reduced-motion for the breathing animation.
 */

import { type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

export function AndroDemoFrame({ children }: Props) {
  return (
    <div className="relative w-full max-w-4xl mx-auto px-4">
      {/* ── Mascot face silhouette (desktop only) ── */}
      <div className="hidden md:block absolute inset-0 pointer-events-none" aria-hidden="true">
        {/* Extend SVG beyond container for dramatic effect */}
        <div className="absolute -inset-x-16 -top-20 -bottom-12">
          <svg
            viewBox="0 0 800 750"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full h-full andro-frame-breathe"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              {/* Face fill — visible on dark backgrounds */}
              <linearGradient id="faceGrad" x1="400" y1="0" x2="400" y2="750" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.18" />
                <stop offset="40%" stopColor="hsl(var(--primary))" stopOpacity="0.10" />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.04" />
              </linearGradient>

              {/* Visor inner glow */}
              <filter id="visorGlow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="12" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>

              {/* Eye glow */}
              <filter id="eyeGlow">
                <feGaussianBlur stdDeviation="6" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>

              {/* Outer shadow */}
              <filter id="faceShadow">
                <feDropShadow dx="0" dy="6" stdDeviation="18" floodColor="hsl(var(--primary))" floodOpacity="0.15" />
              </filter>

              {/* Antenna tip glow */}
              <radialGradient id="antennaGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.5" />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* ── Head outline ── */}
            <path
              d="
                M 400 50
                C 570 50, 700 130, 720 260
                C 740 390, 720 510, 675 585
                C 630 660, 545 720, 400 730
                C 255 720, 170 660, 125 585
                C 80 510, 60 390, 80 260
                C 100 130, 230 50, 400 50
                Z
              "
              fill="url(#faceGrad)"
              stroke="hsl(var(--primary))"
              strokeWidth="2"
              strokeOpacity="0.25"
              filter="url(#faceShadow)"
            />

            {/* ── Antenna ── */}
            <line
              x1="400" y1="50" x2="400" y2="10"
              stroke="hsl(var(--primary))"
              strokeWidth="2.5"
              strokeOpacity="0.35"
              strokeLinecap="round"
            />
            {/* Antenna glow orb */}
            <circle cx="400" cy="8" r="14" fill="url(#antennaGlow)" />
            <circle
              cx="400" cy="8" r="5"
              fill="hsl(var(--primary))"
              fillOpacity="0.4"
            />

            {/* ── Eyes (above the visor) ── */}
            {/* Left eye */}
            <ellipse
              cx="280" cy="195"
              rx="32" ry="22"
              fill="hsl(var(--primary))"
              fillOpacity="0.08"
              stroke="hsl(var(--primary))"
              strokeWidth="1.5"
              strokeOpacity="0.2"
              filter="url(#eyeGlow)"
            />
            <circle cx="280" cy="195" r="10" fill="hsl(var(--primary))" fillOpacity="0.2" />
            <circle cx="280" cy="195" r="4" fill="hsl(var(--primary))" fillOpacity="0.35" />

            {/* Right eye */}
            <ellipse
              cx="520" cy="195"
              rx="32" ry="22"
              fill="hsl(var(--primary))"
              fillOpacity="0.08"
              stroke="hsl(var(--primary))"
              strokeWidth="1.5"
              strokeOpacity="0.2"
              filter="url(#eyeGlow)"
            />
            <circle cx="520" cy="195" r="10" fill="hsl(var(--primary))" fillOpacity="0.2" />
            <circle cx="520" cy="195" r="4" fill="hsl(var(--primary))" fillOpacity="0.35" />

            {/* ── Visor border glow (frames the demo content) ── */}
            <rect
              x="110" y="245" width="580" height="340" rx="28"
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="2"
              strokeOpacity="0.15"
              filter="url(#visorGlow)"
            />
            {/* Inner visor highlight line */}
            <rect
              x="115" y="250" width="570" height="330" rx="24"
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="0.5"
              strokeOpacity="0.08"
            />

            {/* ── Mouth (below the visor) ── */}
            <path
              d="M 330 630 Q 400 665, 470 630"
              stroke="hsl(var(--primary))"
              strokeWidth="2.5"
              strokeOpacity="0.2"
              fill="none"
              strokeLinecap="round"
            />

            {/* ── Ear accents ── */}
            <path
              d="M 75 300 Q 55 350, 65 400"
              stroke="hsl(var(--primary))"
              strokeWidth="1.5"
              strokeOpacity="0.12"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M 725 300 Q 745 350, 735 400"
              stroke="hsl(var(--primary))"
              strokeWidth="1.5"
              strokeOpacity="0.12"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>

      {/* ── Mobile: subtle top accent with mini mascot cues ── */}
      <div className="md:hidden mb-4" aria-hidden="true">
        <svg viewBox="0 0 400 50" className="w-full h-10 andro-frame-breathe" preserveAspectRatio="xMidYMid meet">
          {/* Head curve */}
          <path
            d="M 30 45 Q 200 5, 370 45"
            stroke="hsl(var(--primary))"
            strokeWidth="2"
            strokeOpacity="0.25"
            fill="none"
            strokeLinecap="round"
          />
          {/* Eyes */}
          <circle cx="155" cy="28" r="5" fill="hsl(var(--primary))" fillOpacity="0.2" />
          <circle cx="155" cy="28" r="2" fill="hsl(var(--primary))" fillOpacity="0.4" />
          <circle cx="245" cy="28" r="5" fill="hsl(var(--primary))" fillOpacity="0.2" />
          <circle cx="245" cy="28" r="2" fill="hsl(var(--primary))" fillOpacity="0.4" />
          {/* Antenna */}
          <line x1="200" y1="10" x2="200" y2="0" stroke="hsl(var(--primary))" strokeWidth="2" strokeOpacity="0.3" strokeLinecap="round" />
          <circle cx="200" cy="0" r="3" fill="hsl(var(--primary))" fillOpacity="0.3" />
        </svg>
      </div>

      {/* ── Demo content (the "visor" area) ── */}
      <div className="relative z-10">
        <div className="
          md:bg-card/80 md:backdrop-blur-sm
          md:border md:border-primary/10
          md:rounded-2xl md:shadow-lg md:shadow-primary/5
          md:px-8 md:py-10
        ">
          {children}
        </div>
      </div>

      {/* ── Mobile: bottom accent ── */}
      <div className="md:hidden mt-4" aria-hidden="true">
        <svg viewBox="0 0 400 30" className="w-full h-6" preserveAspectRatio="xMidYMid meet">
          <path
            d="M 80 5 Q 200 30, 320 5"
            stroke="hsl(var(--primary))"
            strokeWidth="2"
            strokeOpacity="0.2"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}
