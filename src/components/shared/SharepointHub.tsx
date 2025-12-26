import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ExternalLink,
  FolderOpen,
  AlertTriangle,
  Upload,
  FileText,
  X,
  Loader2,
  Save,
  BellOff,
  Check,
  Clock,
  Download,
  Trash2,
  Link2,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateColombia } from "@/lib/constants";

interface MatterFile {
  id: string;
  original_filename: string;
  file_path: string;
  file_size: number;
  description: string | null;
  uploaded_at: string;
}

interface SharepointHubProps {
  matterId: string;
  sharepointUrl?: string | null;
  alertsDismissed?: boolean;
  matterName?: string;
  onUpdate?: () => void;
}

export function SharepointHub({
  matterId,
  sharepointUrl,
  alertsDismissed,
  matterName,
  onUpdate,
}: SharepointHubProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlInput, setUrlInput] = useState(sharepointUrl || "");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deleteFileId, setDeleteFileId] = useState<string | null>(null);
  const [deleteFilePath, setDeleteFilePath] = useState<string | null>(null);

  // Fetch matter files
  const { data: matterFiles, isLoading: filesLoading } = useQuery({
    queryKey: ["matter-files", matterId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matter_files")
        .select("*")
        .eq("matter_id", matterId)
        .order("uploaded_at", { ascending: false });

      if (error) throw error;
      return data as MatterFile[];
    },
    enabled: !!matterId,
  });

  // Update Sharepoint URL mutation
  const updateSharepointUrl = useMutation({
    mutationFn: async (newUrl: string | null) => {
      const { error } = await supabase
        .from("matters")
        .update({
          sharepoint_url: newUrl,
          sharepoint_alerts_dismissed: false,
        })
        .eq("id", matterId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["matter", matterId] });
      toast.success("Enlace Sharepoint actualizado");
      setEditingUrl(false);
      onUpdate?.();
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Dismiss alerts mutation
  const dismissAlerts = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("matters")
        .update({ sharepoint_alerts_dismissed: true })
        .eq("id", matterId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["matter", matterId] });
      toast.success("Alertas desactivadas para este asunto");
      onUpdate?.();
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Upload file mutation
  const uploadFile = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error("Seleccione un archivo");

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      setUploadProgress(10);

      const timestamp = Date.now();
      const sanitizedFilename = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = `${user.id}/matters/${matterId}/${timestamp}_${sanitizedFilename}`;

      setUploadProgress(30);

      const { error: uploadError } = await supabase.storage
        .from("lexdocket")
        .upload(filePath, selectedFile, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      setUploadProgress(70);

      const { error: dbError } = await supabase.from("matter_files").insert({
        matter_id: matterId,
        owner_id: user.id,
        file_path: filePath,
        original_filename: selectedFile.name,
        file_size: selectedFile.size,
        file_type: selectedFile.type,
      });

      if (dbError) {
        await supabase.storage.from("lexdocket").remove([filePath]);
        throw dbError;
      }

      setUploadProgress(100);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["matter-files", matterId] });
      toast.success("Archivo cargado exitosamente");
      setSelectedFile(null);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (error) => {
      toast.error("Error al cargar: " + error.message);
      setUploadProgress(0);
    },
  });

  // Delete file mutation
  const deleteFile = useMutation({
    mutationFn: async ({ id, filePath }: { id: string; filePath: string }) => {
      const { error: storageError } = await supabase.storage
        .from("lexdocket")
        .remove([filePath]);

      if (storageError) {
        console.warn("Storage delete error:", storageError);
      }

      const { error: dbError } = await supabase
        .from("matter_files")
        .delete()
        .eq("id", id);

      if (dbError) throw dbError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["matter-files", matterId] });
      toast.success("Archivo eliminado");
      setDeleteFileId(null);
      setDeleteFilePath(null);
    },
    onError: (error) => {
      toast.error("Error al eliminar: " + error.message);
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      toast.error("El archivo no puede superar 50MB");
      return;
    }

    setSelectedFile(file);
  };

  const handleDownload = async (filePath: string, filename: string) => {
    try {
      const { data, error } = await supabase.storage
        .from("lexdocket")
        .download(filePath);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Error al descargar el archivo");
    }
  };

  const handleOpenInNewTab = async (filePath: string) => {
    try {
      const { data, error } = await supabase.storage
        .from("lexdocket")
        .createSignedUrl(filePath, 3600);

      if (error) throw error;
      window.open(data.signedUrl, "_blank");
    } catch {
      toast.error("Error al abrir el archivo");
    }
  };

  const clearSelection = () => {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  };

  const isValidSharepointUrl = (url: string): boolean => {
    if (!url) return false;
    const lowerUrl = url.toLowerCase();
    return (
      lowerUrl.includes("sharepoint.com") ||
      lowerUrl.includes("onedrive.com") ||
      lowerUrl.includes("teams.microsoft.com") ||
      lowerUrl.startsWith("https://")
    );
  };

  const hasValidSharepoint = sharepointUrl && isValidSharepointUrl(sharepointUrl);
  const showAlert = !hasValidSharepoint && !alertsDismissed;

  return (
    <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <FolderOpen className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Centro de Documentos</CardTitle>
              <CardDescription>
                {matterName ? `Asunto: ${matterName}` : "Gestión documental del expediente"}
              </CardDescription>
            </div>
          </div>
          {hasValidSharepoint && (
            <Badge variant="default" className="gap-1">
              <Check className="h-3 w-3" />
              Sharepoint Vinculado
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Alert when no Sharepoint link */}
        {showAlert && (
          <Alert variant="destructive" className="bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertTitle className="text-amber-800 dark:text-amber-300">
              Enlace Sharepoint Requerido
            </AlertTitle>
            <AlertDescription className="text-amber-700 dark:text-amber-400">
              <p className="mb-3">
                No se ha configurado un enlace a Sharepoint para este asunto.
                Proporcione la URL de la carpeta de Sharepoint o cargue los archivos manualmente.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditingUrl(true)}
                  className="gap-1 border-amber-300 hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900"
                >
                  <Link2 className="h-4 w-4" />
                  Agregar Enlace Sharepoint
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => dismissAlerts.mutate()}
                  disabled={dismissAlerts.isPending}
                  className="gap-1 text-amber-700 hover:text-amber-800 hover:bg-amber-100"
                >
                  <BellOff className="h-4 w-4" />
                  Desactivar Alertas
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Sharepoint Link Section */}
        <div className="space-y-2">
          <Label className="text-sm font-medium flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Enlace Sharepoint / OneDrive
          </Label>

          {editingUrl || !sharepointUrl ? (
            <div className="flex gap-2">
              <Input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://empresa.sharepoint.com/sites/..."
                className="flex-1"
              />
              <Button
                onClick={() => updateSharepointUrl.mutate(urlInput || null)}
                disabled={updateSharepointUrl.isPending}
                size="sm"
              >
                {updateSharepointUrl.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
              </Button>
              {editingUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditingUrl(false);
                    setUrlInput(sharepointUrl || "");
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border">
              <ExternalLink className="h-4 w-4 text-primary shrink-0" />
              <a
                href={sharepointUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline truncate flex-1 font-medium"
              >
                Abrir Carpeta en Sharepoint
              </a>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditingUrl(true)}
              >
                Editar
              </Button>
            </div>
          )}
        </div>

        {/* File Upload Section (alternative to Sharepoint) */}
        <div className="pt-2 border-t">
          <div className="flex items-center justify-between mb-3">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Archivos del Asunto
            </Label>
            {(matterFiles?.length || 0) > 0 && (
              <Badge variant="secondary">
                {matterFiles?.length} archivo{(matterFiles?.length || 0) !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelect}
            className="hidden"
          />

          {!selectedFile ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors"
            >
              <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
              <p className="font-medium text-sm">Haga clic para cargar un archivo</p>
              <p className="text-xs text-muted-foreground mt-1">
                Máximo 50MB • Cualquier tipo de archivo
              </p>
            </div>
          ) : (
            <div className="border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-3">
                <FileText className="h-6 w-6 text-primary" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate text-sm">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(selectedFile.size)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={clearSelection}
                  disabled={uploadFile.isPending}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <Button
                onClick={() => uploadFile.mutate()}
                disabled={uploadFile.isPending}
                className="w-full"
                size="sm"
              >
                {uploadFile.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Cargando...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Cargar Archivo
                  </>
                )}
              </Button>

              {uploadFile.isPending && (
                <Progress value={uploadProgress} className="h-1" />
              )}
            </div>
          )}

          {/* Files List */}
          {filesLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (matterFiles?.length || 0) > 0 ? (
            <div className="mt-3 space-y-2">
              {matterFiles?.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between p-2 bg-muted/30 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <FileText className="h-4 w-4 text-primary shrink-0" />
                    <div className="min-w-0">
                      <p
                        className="text-sm font-medium truncate cursor-pointer hover:text-primary"
                        onClick={() => handleOpenInNewTab(file.file_path)}
                        title="Abrir archivo"
                      >
                        {file.original_filename}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {formatFileSize(file.file_size)}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDateColombia(file.uploaded_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleDownload(file.file_path, file.original_filename)}
                      title="Descargar"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => {
                        setDeleteFileId(file.id);
                        setDeleteFilePath(file.file_path);
                      }}
                      title="Eliminar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </CardContent>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteFileId} onOpenChange={() => setDeleteFileId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar archivo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El archivo será eliminado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteFileId && deleteFilePath) {
                  deleteFile.mutate({ id: deleteFileId, filePath: deleteFilePath });
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
