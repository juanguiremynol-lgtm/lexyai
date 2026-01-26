/**
 * Notification Recipient Dialog
 * Add/edit recipients for organization email notifications
 */

import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { toast } from "sonner";
import {
  createNotificationRecipient,
  updateNotificationRecipient,
} from "@/lib/email-notifications/notification-rules-service";
import type { NotificationRecipient } from "@/lib/email-notifications/types";

interface NotificationRecipientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  recipient?: NotificationRecipient | null;
}

export function NotificationRecipientDialog({
  open,
  onOpenChange,
  organizationId,
  recipient,
}: NotificationRecipientDialogProps) {
  const queryClient = useQueryClient();
  const isEditing = !!recipient;
  const [saving, setSaving] = useState(false);

  // Form state
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      if (recipient) {
        setEmail(recipient.email);
        setLabel(recipient.label);
        setEnabled(recipient.enabled);
        setTags(recipient.tags || []);
      } else {
        setEmail("");
        setLabel("");
        setEnabled(true);
        setTags([]);
      }
      setNewTag("");
    }
  }, [open, recipient]);

  const addTag = () => {
    const tag = newTag.trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
      setNewTag("");
    }
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const validateEmail = (email: string): boolean => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  };

  const handleSubmit = async () => {
    if (!email.trim()) {
      toast.error("El email es requerido");
      return;
    }

    if (!validateEmail(email.trim())) {
      toast.error("El email no es válido");
      return;
    }

    if (!label.trim()) {
      toast.error("La etiqueta es requerida");
      return;
    }

    setSaving(true);
    try {
      const formData = {
        email: email.trim().toLowerCase(),
        label: label.trim(),
        enabled,
        tags,
      };

      if (isEditing && recipient) {
        await updateNotificationRecipient(recipient.id, formData);
        toast.success("Destinatario actualizado");
      } else {
        await createNotificationRecipient(organizationId, formData);
        toast.success("Destinatario agregado");
      }

      queryClient.invalidateQueries({ queryKey: ["notification-recipients", organizationId] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Error: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Editar Destinatario" : "Agregar Destinatario"}
          </DialogTitle>
          <DialogDescription>
            Agregue emails al directorio de notificaciones de la organización
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <Label>Email *</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@dominio.com"
            />
          </div>

          <div>
            <Label>Etiqueta *</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ej: Administrador Principal, Contabilidad..."
            />
            <p className="text-xs text-muted-foreground mt-1">
              Nombre descriptivo para identificar este destinatario
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            <Label>Activo</Label>
          </div>

          <div>
            <Label>Etiquetas (opcional)</Label>
            <div className="flex gap-2 mt-2">
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="Agregar etiqueta..."
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
              />
              <Button type="button" variant="outline" size="sm" onClick={addTag}>
                Agregar
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1">
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Use etiquetas para agrupar destinatarios (ej: legal, admin, urgente)
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Guardando..." : isEditing ? "Actualizar" : "Agregar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
