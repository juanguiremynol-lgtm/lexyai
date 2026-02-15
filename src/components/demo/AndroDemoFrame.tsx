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
    <div className="relative w-full max-w-5xl mx-auto px-4">
      {/* ── Mascot face silhouette (desktop only) ── */}
      <div className="hidden md:block absolute inset-0 pointer-events-none" aria-hidden="true">
        {/* Extend SVG well beyond container to wrap the full dialog */}
        <div className="absolute -inset-x-32 -top-32 -bottom-24">
          <svg
            viewBox="0 0 900 1000"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full h-full andro-frame-breathe"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <linearGradient id="faceGrad" x1="450" y1="0" x2="450" y2="1000" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.18" />
                <stop offset="35%" stopColor="hsl(var(--primary))" stopOpacity="0.10" />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.03" />
              </linearGradient>

              <filter id="visorGlow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="14" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>

              <filter id="eyeGlow">
                <feGaussianBlur stdDeviation="8" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>

              <filter id="faceShadow">
                <feDropShadow dx="0" dy="8" stdDeviation="24" floodColor="hsl(var(--primary))" floodOpacity="0.18" />
              </filter>

              <radialGradient id="antennaGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.6" />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* ── Head outline — tall enough to wrap the full demo content ── */}
            <path
              d="
                M 450 55
                C 650 55, 810 160, 835 330
                C 860 500, 845 700, 790 800
                C 735 900, 610 960, 450 970
                C 290 960, 165 900, 110 800
                C 55 700, 40 500, 65 330
                C 90 160, 250 55, 450 55
                Z
              "
              fill="url(#faceGrad)"
              stroke="hsl(var(--primary))"
              strokeWidth="2.5"
              strokeOpacity="0.28"
              filter="url(#faceShadow)"
            />

            {/* ── Antenna ── */}
            <line
              x1="450" y1="55" x2="450" y2="10"
              stroke="hsl(var(--primary))"
              strokeWidth="3"
              strokeOpacity="0.4"
              strokeLinecap="round"
            />
            <circle cx="450" cy="8" r="18" fill="url(#antennaGlow)" />
            <circle cx="450" cy="8" r="6" fill="hsl(var(--primary))" fillOpacity="0.45" />

            {/* ── Eyes ── */}
            {/* Left eye */}
            <ellipse
              cx="310" cy="200"
              rx="38" ry="26"
              fill="hsl(var(--primary))" fillOpacity="0.08"
              stroke="hsl(var(--primary))" strokeWidth="1.8" strokeOpacity="0.22"
              filter="url(#eyeGlow)"
            />
            <circle cx="310" cy="200" r="12" fill="hsl(var(--primary))" fillOpacity="0.22" />
            <circle cx="310" cy="200" r="5" fill="hsl(var(--primary))" fillOpacity="0.4" />

            {/* Right eye */}
            <ellipse
              cx="590" cy="200"
              rx="38" ry="26"
              fill="hsl(var(--primary))" fillOpacity="0.08"
              stroke="hsl(var(--primary))" strokeWidth="1.8" strokeOpacity="0.22"
              filter="url(#eyeGlow)"
            />
            <circle cx="590" cy="200" r="12" fill="hsl(var(--primary))" fillOpacity="0.22" />
            <circle cx="590" cy="200" r="5" fill="hsl(var(--primary))" fillOpacity="0.4" />

            {/* ── Visor border — wraps the demo content area ── */}
            <rect
              x="100" y="260" width="700" height="530" rx="32"
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="2.5"
              strokeOpacity="0.18"
              filter="url(#visorGlow)"
            />
            <rect
              x="106" y="266" width="688" height="518" rx="28"
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="0.8"
              strokeOpacity="0.08"
            />

            {/* ── Mouth ── */}
            <path
              d="M 370 860 Q 450 900, 530 860"
              stroke="hsl(var(--primary))"
              strokeWidth="3"
              strokeOpacity="0.22"
              fill="none"
              strokeLinecap="round"
            />

            {/* ── Ear accents ── */}
            <path
              d="M 58 380 Q 32 450, 45 530"
              stroke="hsl(var(--primary))" strokeWidth="2" strokeOpacity="0.14"
              fill="none" strokeLinecap="round"
            />
            <path
              d="M 842 380 Q 868 450, 855 530"
              stroke="hsl(var(--primary))" strokeWidth="2" strokeOpacity="0.14"
              fill="none" strokeLinecap="round"
            />
          </svg>
        </div>
      </div>

      {/* ── Mobile: subtle top accent with mini mascot cues ── */}
      <div className="md:hidden mb-4" aria-hidden="true">
        <svg viewBox="0 0 400 50" className="w-full h-10 andro-frame-breathe" preserveAspectRatio="xMidYMid meet">
          <path
            d="M 30 45 Q 200 5, 370 45"
            stroke="hsl(var(--primary))"
            strokeWidth="2"
            strokeOpacity="0.25"
            fill="none"
            strokeLinecap="round"
          />
          <circle cx="155" cy="28" r="5" fill="hsl(var(--primary))" fillOpacity="0.2" />
          <circle cx="155" cy="28" r="2" fill="hsl(var(--primary))" fillOpacity="0.4" />
          <circle cx="245" cy="28" r="5" fill="hsl(var(--primary))" fillOpacity="0.2" />
          <circle cx="245" cy="28" r="2" fill="hsl(var(--primary))" fillOpacity="0.4" />
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
