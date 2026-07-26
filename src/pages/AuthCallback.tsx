/**
 * AuthCallback — public landing target for social (Google/Apple) sign-in.
 *
 * Social OAuth is a full-page redirect: the provider sends the browser back to
 * `redirect_uri` BEFORE the session is written. Pointing `redirect_uri` at the
 * MCP consent URL therefore raced the session and dropped the user on `/`.
 * This route is the stable public callback: it waits for the session to
 * hydrate and only then navigates to the preserved same-origin `next` path.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const POST_AUTH_NEXT_KEY = "andromeda_post_auth_next";

/** Only same-origin relative paths are accepted as a return target. */
export function sanitizeNext(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

export default function AuthCallback() {
  const [message, setMessage] = useState("Completando el inicio de sesión…");

  useEffect(() => {
    let done = false;

    const go = () => {
      if (done) return;
      done = true;
      const stored = sanitizeNext(sessionStorage.getItem(POST_AUTH_NEXT_KEY));
      const fromQuery = sanitizeNext(new URLSearchParams(window.location.search).get("next"));
      sessionStorage.removeItem(POST_AUTH_NEXT_KEY);
      window.location.replace(fromQuery ?? stored ?? "/dashboard");
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) go();
    });

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) go();
    })();

    // Safety net: if no session materializes, send the user back to sign in
    // preserving the original destination.
    const timer = window.setTimeout(() => {
      if (done) return;
      done = true;
      const stored = sanitizeNext(sessionStorage.getItem(POST_AUTH_NEXT_KEY));
      setMessage("No se pudo completar el inicio de sesión.");
      window.location.replace(stored ? `/auth?next=${encodeURIComponent(stored)}` : "/auth");
    }, 8000);

    return () => {
      sub.subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#070b1a] text-[#a0b4d0]">
      <p className="text-sm">{message}</p>
    </div>
  );
}