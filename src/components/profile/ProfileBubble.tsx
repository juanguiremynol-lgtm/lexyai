/**
 * ProfileBubble: A floating avatar bubble showing the user's profile picture.
 * Falls back to a random-color circle with initials if no photo.
 * Can be disabled via Andro IA (mascot_preferences.visible).
 */
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const BUBBLE_COLORS = [
  "bg-rose-500", "bg-amber-500", "bg-emerald-500",
  "bg-cyan-500", "bg-violet-500", "bg-fuchsia-500",
  "bg-sky-500", "bg-orange-500",
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function ProfileBubble() {
  const [profile, setProfile] = useState<{
    full_name: string | null;
    avatar_url: string | null;
    mascot_preferences: { visible?: boolean } | null;
  } | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const { data } = await supabase
        .from("profiles")
        .select("full_name, avatar_url, mascot_preferences")
        .eq("id", user.id)
        .maybeSingle();

      setProfile(data ? { ...data, mascot_preferences: data.mascot_preferences as { visible?: boolean } | null } : null);
    };
    load();
  }, []);

  // Check if bubble should be visible (controlled by mascot_preferences.visible)
  const isVisible = profile?.mascot_preferences?.visible !== false;

  const initials = useMemo(() => {
    if (!profile?.full_name) return "?";
    return profile.full_name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }, [profile?.full_name]);

  const bgColor = useMemo(() => {
    if (!userId) return BUBBLE_COLORS[0];
    return BUBBLE_COLORS[hashString(userId) % BUBBLE_COLORS.length];
  }, [userId]);

  if (!profile || !isVisible) return null;

  return (
    <div className={cn(
      "fixed bottom-6 right-6 z-50",
      "transition-all duration-300 ease-out",
      "hover:scale-110 cursor-pointer",
      "drop-shadow-lg"
    )}>
      <Avatar className="h-12 w-12 border-2 border-[#d4a017]/40 shadow-[0_0_20px_rgba(212,160,23,0.15)]">
        <AvatarImage src={profile.avatar_url || undefined} />
        <AvatarFallback className={cn(bgColor, "text-white font-semibold text-sm")}>
          {initials}
        </AvatarFallback>
      </Avatar>
    </div>
  );
}
