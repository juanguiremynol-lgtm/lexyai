import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Send, Save, Paperclip, X, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { sendEmail, PLATFORM_EMAIL } from "@/lib/email/email-client-service";

interface EmailComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  replyTo?: { to: string; subject: string };
  onSent?: () => void;
}

export function EmailComposeDialog({ open, onOpenChange, onSent }: EmailComposeDialogProps) {
  const [to, setTo] = useState("");
  const [toList, setToList] = useState<string[]>([]);
  const [cc, setCc] = useState("");
  const [ccList, setCcList] = useState<string[]>([]);
  const [bcc, setBcc] = useState("");
  const [bccList, setBccList] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [sending, setSending] = useState(false);

  const addTag = (
    value: string,
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>,
    setValue: React.Dispatch<React.SetStateAction<string>>
  ) => {
    const email = value.trim();
    if (email && email.includes("@") && !list.includes(email)) {
      setList([...list, email]);
      setValue("");
    }
  };

  const removeTag = (
    email: string,
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    setList(list.filter((e) => e !== email));
  };

  const handleKeyDown = (
    e: React.KeyboardEvent,
    value: string,
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>,
    setValue: React.Dispatch<React.SetStateAction<string>>
  ) => {
    if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
      e.preventDefault();
      addTag(value, list, setList, setValue);
    }
  };

  const handleSend = async () => {
    if (toList.length === 0) {
      toast.error("Agrega al menos un destinatario");
      return;
    }
    if (!subject.trim()) {
      toast.error("Agrega un asunto");
      return;
    }

    setSending(true);
    try {
      await sendEmail({
        to: toList,
        cc: ccList.length > 0 ? ccList : undefined,
        bcc: bccList.length > 0 ? bccList : undefined,
        subject,
        body,
      });
      toast.success("Email encolado para envío vía proveedor activo");
      resetForm();
      onOpenChange(false);
      onSent?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al enviar email");
    } finally {
      setSending(false);
    }
  };

  const handleSaveDraft = () => {
    toast.success("Borrador guardado (próximamente)");
  };

  const resetForm = () => {
    setTo(""); setToList([]);
    setCc(""); setCcList([]);
    setBcc(""); setBccList([]);
    setSubject(""); setBody("");
    setShowCcBcc(false);
  };

  const TagInput = ({
    label,
    value,
    onChange,
    list,
    setList,
    setValue,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    list: string[];
    setList: React.Dispatch<React.SetStateAction<string[]>>;
    setValue: React.Dispatch<React.SetStateAction<string>>;
  }) => (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex flex-wrap items-center gap-1 border border-input rounded-md p-1.5 bg-background focus-within:ring-2 focus-within:ring-primary/50 min-h-[40px]">
        {list.map((email) => (
          <Badge key={email} variant="secondary" className="text-xs gap-1 py-0.5">
            {email}
            <button onClick={() => removeTag(email, list, setList)} className="hover:text-destructive">
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <input
          type="email"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, value, list, setList, setValue)}
          onBlur={() => addTag(value, list, setList, setValue)}
          placeholder={list.length === 0 ? "email@ejemplo.com" : ""}
          className="flex-1 min-w-[120px] bg-transparent border-0 outline-none text-sm placeholder:text-muted-foreground/70 py-1"
        />
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Nuevo Email</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Desde: <span className="font-medium text-foreground">{PLATFORM_EMAIL}</span>
            {" "}— se enviará vía el proveedor activo configurado
          </p>
        </DialogHeader>

        <div className="space-y-3 flex-1 overflow-y-auto py-2">
          <TagInput label="Para" value={to} onChange={setTo} list={toList} setList={setToList} setValue={setTo} />

          <button
            onClick={() => setShowCcBcc(!showCcBcc)}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            CC / BCC {showCcBcc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {showCcBcc && (
            <>
              <TagInput label="CC" value={cc} onChange={setCc} list={ccList} setList={setCcList} setValue={setCc} />
              <TagInput label="BCC" value={bcc} onChange={setBcc} list={bccList} setList={setBccList} setValue={setBcc} />
            </>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Asunto</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Asunto del email" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Mensaje</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Escribe tu mensaje..."
              rows={10}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => toast.info("Adjuntos — próximamente")}>
            <Paperclip className="h-4 w-4 mr-1" /> Adjuntar
          </Button>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={handleSaveDraft} disabled={sending}>
            <Save className="h-4 w-4 mr-1" /> Borrador
          </Button>
          <Button size="sm" onClick={handleSend} disabled={sending}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
