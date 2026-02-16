import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { Camera, LogOut, Loader2, Shield } from "lucide-react";
import logo from "@/assets/andromeda-logo.png";
import { useQueryClient } from "@tanstack/react-query";

export default function OnboardingProfile() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Load existing profile data (pre-populated from OAuth or previous attempt)
  useEffect(() => {
    const loadProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate("/auth");
        return;
      }

      // Set email from auth
      setEmail(user.email || "");

      // Check if profile exists
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, avatar_url, address, phone, profile_completed_at")
        .eq("id", user.id)
        .maybeSingle();

      if (profile?.profile_completed_at) {
        // Profile already complete, redirect to app
        navigate("/app/dashboard", { replace: true });
        return;
      }

      // Pre-fill from profile or OAuth metadata
      if (profile?.full_name) setFullName(profile.full_name);
      if (profile?.avatar_url) {
        setAvatarUrl(profile.avatar_url);
        setAvatarPreview(profile.avatar_url);
      }
      if (profile?.address) setAddress(profile.address);
      if (profile?.phone) setPhone(profile.phone);

      // Fallback to user metadata if profile fields are empty
      if (!profile?.full_name && user.user_metadata?.full_name) {
        setFullName(user.user_metadata.full_name);
      }
      if (!profile?.avatar_url && user.user_metadata?.avatar_url) {
        setAvatarUrl(user.user_metadata.avatar_url);
        setAvatarPreview(user.user_metadata.avatar_url);
      }

      setInitialLoading(false);
    };
    loadProfile();
  }, [navigate]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!avatarPreview && !avatarFile) newErrors.avatar = "Por favor agrega una foto de perfil para continuar.";
    if (!fullName.trim()) newErrors.fullName = "Ingresa tu nombre completo.";
    if (!address.trim()) newErrors.address = "Ingresa una dirección (puede ser tu dirección de oficina).";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error("La imagen no puede superar los 5MB");
      return;
    }

    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    setErrors((prev) => ({ ...prev, avatar: "" }));
  };

  const uploadAvatar = async (userId: string): Promise<string | null> => {
    if (!avatarFile) return avatarUrl; // Keep existing URL if no new file

    setUploading(true);
    try {
      const ext = avatarFile.name.split(".").pop() || "jpg";
      const filePath = `${userId}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, avatarFile, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("avatars")
        .getPublicUrl(filePath);

      return publicUrl;
    } catch (err) {
      console.error("Avatar upload error:", err);
      toast.error("Error al subir la foto de perfil");
      return null;
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      // Upload avatar if new file selected
      const finalAvatarUrl = await uploadAvatar(user.id);

      // Upsert profile
      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          full_name: fullName.trim(),
          avatar_url: finalAvatarUrl,
          address: address.trim(),
          phone: phone.trim() || null,
          email: email,
          profile_completed_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (profileError) throw profileError;

      // Invalidate profile queries so guards re-check
      queryClient.invalidateQueries({ queryKey: ["profile-completion"] });

      toast.success("Perfil guardado.");
      navigate("/app/dashboard", { replace: true });
    } catch (err: any) {
      console.error("Profile save error:", err);
      toast.error(err.message || "Error al guardar el perfil");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  if (initialLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#070b1a]">
        <Loader2 className="h-8 w-8 animate-spin text-[#d4a017]" />
      </div>
    );
  }

  const initials = fullName
    ? fullName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden bg-[#070b1a]">
      {/* Cosmic background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] rounded-full bg-[#1a3a6a]/20 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] rounded-full bg-[#0ea5e9]/10 blur-[100px]" />
      </div>

      <Card className="w-full max-w-lg relative border-[#d4a017]/20 bg-[#0c1529]/80 backdrop-blur-xl shadow-[0_0_60px_rgba(212,160,23,0.08)] z-10">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-1 bg-gradient-to-r from-[#d4a017]/50 via-[#d4a017] to-[#d4a017]/50 rounded-b-full" />

        <CardHeader className="text-center pt-8">
          <img
            src={logo}
            alt="Andromeda"
            className="h-16 w-auto object-contain mx-auto mb-4 drop-shadow-[0_0_20px_rgba(212,160,23,0.3)]"
          />
          <CardTitle className="text-xl text-white">Completa tu perfil</CardTitle>
          <CardDescription className="text-[#a0b4d0] mt-2">
            Usamos esta información para identificar usuarios dentro de las organizaciones
            y mantener los espacios de trabajo atribuibles.
          </CardDescription>
        </CardHeader>

        <CardContent className="pb-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Avatar */}
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="relative group"
              >
                <Avatar className="h-24 w-24 border-2 border-[#d4a017]/30 group-hover:border-[#d4a017]/60 transition-colors">
                  <AvatarImage src={avatarPreview || undefined} />
                  <AvatarFallback className="bg-[#1a3a6a] text-white text-lg">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Camera className="h-6 w-6 text-white" />
                </div>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="hidden"
              />
              <p className="text-xs text-[#a0b4d0]/60">Haz clic para subir tu foto</p>
              {errors.avatar && (
                <p className="text-xs text-red-400">{errors.avatar}</p>
              )}
            </div>

            {/* Full Name */}
            <div className="space-y-2">
              <Label htmlFor="fullName" className="text-sm text-[#a0b4d0]">
                Nombre Completo <span className="text-red-400">*</span>
              </Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  if (errors.fullName) setErrors((p) => ({ ...p, fullName: "" }));
                }}
                placeholder="Juan Pérez"
                className="bg-[#0a1120] border-[#1a3a6a]/50 text-white placeholder:text-[#a0b4d0]/40 focus:border-[#d4a017]/50 focus:ring-[#d4a017]/20"
              />
              {errors.fullName && (
                <p className="text-xs text-red-400">{errors.fullName}</p>
              )}
            </div>

            {/* Email (read-only) */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm text-[#a0b4d0]">
                Correo Electrónico
              </Label>
              <Input
                id="email"
                value={email}
                readOnly
                disabled
                className="bg-[#0a1120]/50 border-[#1a3a6a]/30 text-[#a0b4d0]/70 cursor-not-allowed"
              />
            </div>

            {/* Address */}
            <div className="space-y-2">
              <Label htmlFor="address" className="text-sm text-[#a0b4d0]">
                Dirección <span className="text-red-400">*</span>
              </Label>
              <Input
                id="address"
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  if (errors.address) setErrors((p) => ({ ...p, address: "" }));
                }}
                placeholder="Calle 100 #15-20, Oficina 301, Bogotá"
                className="bg-[#0a1120] border-[#1a3a6a]/50 text-white placeholder:text-[#a0b4d0]/40 focus:border-[#d4a017]/50 focus:ring-[#d4a017]/20"
              />
              {errors.address && (
                <p className="text-xs text-red-400">{errors.address}</p>
              )}
            </div>

            {/* Phone (optional) */}
            <div className="space-y-2">
              <Label htmlFor="phone" className="text-sm text-[#a0b4d0]">
                Teléfono <span className="text-[#a0b4d0]/40 text-xs">(opcional)</span>
              </Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+57 300 123 4567"
                className="bg-[#0a1120] border-[#1a3a6a]/50 text-white placeholder:text-[#a0b4d0]/40 focus:border-[#d4a017]/50 focus:ring-[#d4a017]/20"
              />
            </div>

            {/* Privacy note */}
            <div className="flex items-start gap-2 p-3 rounded-lg bg-[#0ea5e9]/5 border border-[#0ea5e9]/15">
              <Shield className="h-4 w-4 text-[#0ea5e9] mt-0.5 shrink-0" />
              <p className="text-xs text-[#a0b4d0]/80">
                Tu perfil es visible para tu organización según la configuración de acceso basado en roles.
              </p>
            </div>

            {/* Submit */}
            <Button
              type="submit"
              disabled={loading || uploading}
              className="w-full bg-gradient-to-r from-[#d4a017] to-[#e8b830] text-[#070b1a] font-bold hover:from-[#e8b830] hover:to-[#f0c848] shadow-[0_0_30px_rgba(212,160,23,0.3)]"
            >
              {loading || uploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {uploading ? "Subiendo foto..." : "Guardando..."}
                </>
              ) : (
                "Guardar y continuar"
              )}
            </Button>

            {/* Logout */}
            <button
              type="button"
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 text-sm text-[#a0b4d0]/60 hover:text-[#a0b4d0] transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              Cerrar sesión
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
