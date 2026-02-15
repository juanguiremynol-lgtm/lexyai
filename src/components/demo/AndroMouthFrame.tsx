/**
 * AndroMouthFrame — Wraps the demo card inside the Andro IA mascot's
 * mouth opening using a PNG background frame.
 *
 * The PNG is purely decorative; children render as real interactive HTML
 * positioned inside the mouth cavity.
 */

import { type ReactNode } from "react";
import androFrame from "@/assets/andro-mouth-frame.png";
import "./andro-mouth-frame.css";

interface Props {
  children: ReactNode;
}

/**
 * Mouth-slot positioning constants (percentage of the frame).
 * Tweak these to adjust where the card sits inside the mouth.
 */
const MOUTH_SLOT = {
  left: "18%",
  top: "36%",
  width: "64%",
  height: "38%",
} as const;

export function AndroMouthFrame({ children }: Props) {
  return (
    <div className="androHero">
      <div className="androStage">
        {/* Background robot face — decorative, no pointer events */}
        <img
          src={androFrame}
          alt=""
          aria-hidden="true"
          className="androFrameImg"
          draggable={false}
        />

        {/* Mouth slot — card lives here */}
        <div
          className="androMouthSlot"
          style={{
            left: MOUTH_SLOT.left,
            top: MOUTH_SLOT.top,
            width: MOUTH_SLOT.width,
            height: MOUTH_SLOT.height,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
