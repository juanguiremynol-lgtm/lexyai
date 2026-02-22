/**
 * HearingArtifactsSection — Upload + external links for hearing artifacts
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Upload, Link2, FileText, Trash2, Plus, ExternalLink, Download, Music, Image } from "lucide-react";
import { toast } from "sonner";

interface Props {
  hearingId: string;
  organizationId: string;
  workItemId: string;
}

const KIND_LABELS: Record<string, string> = {
  transcript: "Transcripción",
  excerpt: "Extracto",
  audio: "Audio",
  screenshot: "Captura",
  acta: "Acta",
  auto: "Auto",
  other: "Otro",
};

const KIND_ICONS: Record<string, React.ReactNode> = {
  transcript: <FileText className="h-4 w-4" />,
  excerpt: <FileText className="h-4 w-4" />,
  audio: <Music className="h-4 w-4" />,
  screenshot: <Image className="h-4 w-4" />,
  acta: <FileText className="h-4 w-4" />,
  auto: <FileText className="h-4 w-4" />,
  other: <FileText className="h-4 w-4" />,
};

export function HearingArtifactsSection({ hearingId, organizationId, workItemId }: Props) {
  const queryClient = useQueryClient();
  const [showUpload, setShowUpload] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkKind, setLinkKind] = useState("other");

  const { data: artifacts = [] } = useQuery({
    queryKey: ["hearing-artifacts", hearingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hearing_artifacts")
        .select("*")
        .eq("work_item_hearing_id", hearingId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data || [];
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const path = `${organizationId}/${workItemId}/${hearingId}/${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from("hearing-artifacts")
        .upload(path, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from("hearing_artifacts").insert({
        organization_id: organizationId,
        work_item_hearing_id: hearingId,
        kind: guessKind(file.type),
        storage_type: "internal_upload",
        storage_path: path,
        filename: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        uploaded_by: user.id,
      });

      if (insertError) throw insertError;

      // Audit
      await supabase.from("hearing_audit_log").insert({
        organization_id: organizationId,
        user_id: user.id,
        action: "artifact_uploaded",
        work_item_id: workItemId,
        work_item_hearing_id: hearingId,
        detail: { filename: file.name, size_bytes: file.size },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hearing-artifacts", hearingId] });
      toast.success("Archivo subido");
      setShowUpload(false);
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const addLinkMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      let provider = "other";
      if (linkUrl.includes("onedrive") || linkUrl.includes("sharepoint")) provider = "onedrive";
      else if (linkUrl.includes("drive.google")) provider = "google_drive";
      else if (linkUrl.includes("dropbox")) provider = "dropbox";

      const { error } = await supabase.from("hearing_artifacts").insert({
        organization_id: organizationId,
        work_item_hearing_id: hearingId,
        kind: linkKind,
        storage_type: "external_link",
        external_url: linkUrl,
        external_provider: provider,
        title: linkTitle || linkUrl,
        uploaded_by: user.id,
      });

      if (error) throw error;

      await supabase.from("hearing_audit_log").insert({
        organization_id: organizationId,
        user_id: user.id,
        action: "artifact_link_added",
        work_item_id: workItemId,
        work_item_hearing_id: hearingId,
        detail: { url: linkUrl, provider },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hearing-artifacts", hearingId] });
      toast.success("Enlace agregado");
      setShowLink(false);
      setLinkUrl("");
      setLinkTitle("");
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (artifactId: string) => {
      const { error } = await supabase.from("hearing_artifacts").delete().eq("id", artifactId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hearing-artifacts", hearingId] });
      toast.success("Archivo eliminado");
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
  };

  const handleDownload = async (artifact: any) => {
    if (artifact.storage_type === "external_link") {
      window.open(artifact.external_url, "_blank");
      return;
    }
    const { data } = await supabase.storage
      .from("hearing-artifacts")
      .createSignedUrl(artifact.storage_path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Archivos ({artifacts.length})
          </CardTitle>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-7" onClick={() => setShowUpload(!showUpload)}>
              <Upload className="h-3.5 w-3.5 mr-1" />
              Subir
            </Button>
            <Button variant="ghost" size="sm" className="h-7" onClick={() => setShowLink(!showLink)}>
              <Link2 className="h-3.5 w-3.5 mr-1" />
              Enlace
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {showUpload && (
          <div className="border rounded-lg p-3 bg-muted/30">
            <Label>Seleccionar archivo (máx. 50MB)</Label>
            <Input
              type="file"
              accept=".pdf,.docx,.txt,.mp3,.m4a,.mp4,.png,.jpg,.jpeg"
              onChange={handleFileSelect}
              disabled={uploadMutation.isPending}
              className="mt-1"
            />
            {uploadMutation.isPending && <p className="text-xs text-muted-foreground mt-1">Subiendo...</p>}
          </div>
        )}

        {showLink && (
          <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
            <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="URL del archivo" />
            <div className="flex gap-2">
              <Input value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} placeholder="Título (opcional)" className="flex-1" />
              <Select value={linkKind} onValueChange={setLinkKind}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(KIND_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={() => addLinkMutation.mutate()} disabled={!linkUrl.trim()}>
              Agregar enlace
            </Button>
          </div>
        )}

        {artifacts.length === 0 && !showUpload && !showLink && (
          <p className="text-xs text-muted-foreground text-center py-3">Sin archivos adjuntos</p>
        )}

        {artifacts.map((artifact: any) => (
          <div key={artifact.id} className="flex items-center gap-2 p-2 rounded-md hover:bg-accent/50 group">
            {KIND_ICONS[artifact.kind] || <FileText className="h-4 w-4" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">
                {artifact.title || artifact.filename || "Archivo"}
              </p>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">{KIND_LABELS[artifact.kind]}</Badge>
                {artifact.size_bytes && (
                  <span className="text-[10px] text-muted-foreground">
                    {(artifact.size_bytes / 1024 / 1024).toFixed(1)} MB
                  </span>
                )}
                {artifact.external_provider && (
                  <Badge variant="secondary" className="text-[10px]">{artifact.external_provider}</Badge>
                )}
              </div>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDownload(artifact)}>
                {artifact.storage_type === "external_link" ? <ExternalLink className="h-3 w-3" /> : <Download className="h-3 w-3" />}
              </Button>
              <Button
                variant="ghost" size="icon"
                className="h-6 w-6 text-destructive"
                onClick={() => deleteMutation.mutate(artifact.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function guessKind(mimeType: string): string {
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("image/")) return "screenshot";
  if (mimeType === "application/pdf") return "acta";
  return "other";
}
