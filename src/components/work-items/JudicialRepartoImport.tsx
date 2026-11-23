import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ExternalLink, FilePlus2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  invokeReparto, REPARTO_DRAFT_FIELDS, REPARTO_PDF_LIMIT, REPARTO_VENTANILLA,
  type RepartoDraft, type RepartoMail, type RepartoMailChoice, type RepartoMailPreview,
} from "@/lib/judicial-reparto";
import { JudicialRepartoReview } from "./JudicialRepartoReview";

interface Props {
  existingWorkItemId?: string;
  detectionId?: string;
  size?: "default" | "sm";
  onImported?: () => void;
}

export function JudicialRepartoButton({ existingWorkItemId, detectionId, size, onImported }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving || next) setOpen(next); }}>
      <DialogTrigger asChild>
        <Button size={size} variant="outline" type="button">
          <FilePlus2 className="mr-1.5 h-4 w-4" aria-hidden />
          {detectionId || existingWorkItemId ? "Importar comprobante" : "Radicación y reparto"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92svh] w-[calc(100%-1rem)] overflow-y-auto rounded-lg sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Radicación y reparto judicial</DialogTitle>
          <DialogDescription>
            Importa la constancia de recepción o el reparto al expediente.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <ImportPanel existingWorkItemId={existingWorkItemId} detectionId={detectionId}
            onBusy={setSaving} onImported={onImported} onClose={() => setOpen(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImportPanel({ existingWorkItemId, detectionId, onClose, onBusy, onImported }: Props & {
  onClose: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const idPrefix = useId();
  const [tab, setTab] = useState("outlook");
  const [query, setQuery] = useState("reparto");
  const [selection, setSelection] = useState<RepartoMailChoice | null>(detectionId ? { detection_id: detectionId } : null);
  const [attachment, setAttachment] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<RepartoDraft | null>(null);

  const actor = useQuery({
    queryKey: ["judicial-reparto-modal-user"],
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) throw new Error("Inicia sesión para importar un comprobante.");
      return data.user.id;
    },
  });
  const search = useMutation({
    mutationFn: (term: string) => invokeReparto<{ emails: RepartoMail[] }>({ action: "search", query: term }),
  });
  const preview = useQuery({
    queryKey: ["judicial-reparto-message", actor.data, selection],
    enabled: Boolean(actor.data && selection && tab === "outlook" && !draft),
    gcTime: 0,
    retry: false,
    queryFn: () => invokeReparto<RepartoMailPreview>({ action: "inspect", ...selection }),
  });
  const drafts = useQuery({
    queryKey: ["judicial-reparto-drafts", actor.data],
    enabled: Boolean(actor.data && tab === "drafts" && !draft),
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.from("judicial_reparto_imports")
        .select(REPARTO_DRAFT_FIELDS).eq("owner_id", actor.data!).is("work_item_id", null)
        .or("pdf_path.is.null,pdf_stored_at.not.is.null")
        .order("created_at", { ascending: false }).limit(30);
      if (error) throw error;
      return data;
    },
  });
  const prepare = useMutation({
    mutationFn: (input: FormData | Record<string, unknown>) => invokeReparto<{ draft: RepartoDraft }>(input),
    onMutate: () => onBusy(true),
    onSettled: () => onBusy(false),
    onSuccess: ({ draft: prepared }) => {
      setDraft(prepared);
      void queryClient.invalidateQueries({ queryKey: ["judicial-reparto-drafts"] });
    },
  });

  const selectedPdf = attachment ?? (preview.data?.pdfs.length === 1 && preview.data.pdfs[0].size <= REPARTO_PDF_LIMIT
    ? preview.data.pdfs[0].id : "none");
  const startSearch = (event: FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 2 || search.isPending) return;
    setSelection(null);
    setAttachment(null);
    prepare.reset();
    search.mutate(query.trim());
  };
  const prepareFile = () => {
    if (!file || file.size > REPARTO_PDF_LIMIT) return;
    const body = new FormData();
    body.set("pdf", file);
    prepare.mutate(body);
  };
  const imported = (id: string, created: boolean) => {
    const keys = ["judicial-reparto-drafts", "judicial-reparto-matches", "detected-processes", "work-items",
      "cgp-work-items", "cpaca-work-items", "tutelas-work-items", "laboral-work-items", "client-work-items"];
    for (const key of keys) void queryClient.invalidateQueries({ queryKey: [key] });
    void queryClient.invalidateQueries({ queryKey: ["judicial-reparto-evidence", id] });
    void queryClient.invalidateQueries({ queryKey: ["work-item-detail", id] });
    toast.success(created ? "Expediente creado con su comprobante." : "Comprobante vinculado al expediente.");
    onImported?.();
    onClose();
    if (existingWorkItemId !== id) navigate("/app/work-items/" + id + "?tab=documentos");
  };
  const back = () => { setDraft(null); prepare.reset(); };

  if (actor.isPending) return <p className="text-sm text-muted-foreground" role="status">Comprobando la sesión…</p>;
  if (!actor.data) return <p className="text-sm text-destructive" role="alert">Inicia sesión para importar un comprobante.</p>;
  if (draft?.work_item_id) {
    return (
      <div className="space-y-3">
        <p className="text-sm" role="status">Este comprobante ya está vinculado a un expediente.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={back}>Volver</Button>
          <Button asChild><Link to={"/app/work-items/" + draft.work_item_id + "?tab=documentos"} onClick={onClose}>Abrir expediente</Link></Button>
        </div>
      </div>
    );
  }
  if (draft) {
    return (
      <JudicialRepartoReview key={draft.id} draft={draft} userId={actor.data}
        existingWorkItemId={existingWorkItemId} onSaved={imported} onBack={back} onBusy={onBusy} />
    );
  }

  return (
    <div className="space-y-4">
      {!existingWorkItemId && !detectionId && (
        <details className="rounded-md border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Preparar una demanda</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>Ten a mano la seccional, la especialidad y la clase de proceso que vas a seleccionar.</li>
            <li>Reúne la identificación y los datos de notificación de las partes.</li>
            <li>Prepara la demanda y los documentos que el trámite te pide adjuntar.</li>
          </ul>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <a href={REPARTO_VENTANILLA} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden />
              Abrir la Ventanilla Judicial
            </a>
          </Button>
        </details>
      )}
      <Tabs value={tab} onValueChange={(next) => { setTab(next); prepare.reset(); }}>
        <TabsList aria-label="Origen del comprobante">
          <TabsTrigger value="outlook" disabled={prepare.isPending}>Outlook</TabsTrigger>
          <TabsTrigger value="pdf" disabled={prepare.isPending}>PDF</TabsTrigger>
          <TabsTrigger value="drafts" disabled={prepare.isPending}>Borradores</TabsTrigger>
        </TabsList>
        <TabsContent value="outlook" className="space-y-3">
          <form onSubmit={startSearch} className="space-y-1.5">
            <Label htmlFor={idPrefix + "search"}>Buscar constancia o reparto en Outlook</Label>
            <div className="flex gap-2">
              <Input id={idPrefix + "search"} value={query} onChange={(event) => setQuery(event.target.value)} maxLength={120} />
              <Button type="submit" variant="outline" disabled={query.trim().length < 2 || search.isPending || prepare.isPending}>Buscar</Button>
            </div>
          </form>
          <Link className="text-sm text-primary underline" to="/app/settings/connections">Conexión con Outlook</Link>
          {search.error && <p className="text-sm text-destructive" role="alert">{search.error.message}</p>}
          {search.isPending && <p className="text-sm text-muted-foreground" role="status">Buscando correos…</p>}
          {search.isSuccess && !search.data.emails.length && <p className="text-sm text-muted-foreground">No se encontraron correos.</p>}
          {!!search.data?.emails.length && !selection && (
            <ul className="max-h-52 space-y-2 overflow-y-auto">
              {search.data.emails.map((mail) => (
                <li key={mail.id}>
                  <button type="button" className="w-full rounded-md border p-2 text-left text-sm hover:bg-muted"
                    onClick={() => { setSelection({ message_id: mail.id }); setAttachment(null); prepare.reset(); }}>
                    <span className="block break-words font-medium">{mail.subject || "Correo sin asunto"}</span>
                    <span className="break-all text-muted-foreground">{mail.sender}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {selection && preview.isFetching && <p className="text-sm text-muted-foreground" role="status">Leyendo los datos del correo…</p>}
          {selection && preview.error && <p className="text-sm text-destructive" role="alert">{preview.error.message}</p>}
          {selection && preview.data && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="text-sm">
                <p className="break-words font-medium">{preview.data.mail.subject || "Correo sin asunto"}</p>
                {preview.data.mail.sender && <p className="break-all text-muted-foreground">{preview.data.mail.sender}</p>}
              </div>
              {!!preview.data.pdfs.length && (
                <div className="space-y-1.5">
                  <Label htmlFor={idPrefix + "attachment"}>PDF que deseas conservar</Label>
                  <Select value={selectedPdf} onValueChange={setAttachment} disabled={prepare.isPending}>
                    <SelectTrigger id={idPrefix + "attachment"} className="text-left"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Importar solo el correo</SelectItem>
                      {preview.data.pdfs.map((pdf) => (
                        <SelectItem value={pdf.id} key={pdf.id} disabled={pdf.size > REPARTO_PDF_LIMIT}>
                          {pdf.name}{pdf.size > REPARTO_PDF_LIMIT ? " · supera 10 MB" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={prepare.isPending} onClick={() => { setSelection(null); setAttachment(null); }}>Elegir otro correo</Button>
                <Button disabled={prepare.isPending} onClick={() => prepare.mutate({
                  action: "prepare", ...selection, attachment_id: selectedPdf === "none" ? null : selectedPdf,
                })}>Preparar importación</Button>
              </div>
            </div>
          )}
        </TabsContent>
        <TabsContent value="pdf" className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={idPrefix + "file"}>Constancia o acta en PDF (hasta 10 MB)</Label>
            <Input id={idPrefix + "file"} type="file" accept=".pdf,application/pdf" disabled={prepare.isPending}
              onChange={(event) => { setFile(event.target.files?.[0] ?? null); prepare.reset(); }} />
          </div>
          {file && file.size > REPARTO_PDF_LIMIT && <p className="text-sm text-destructive" role="alert">El archivo supera 10 MB.</p>}
          <Button onClick={prepareFile} disabled={!file || file.size > REPARTO_PDF_LIMIT || prepare.isPending}>Preparar importación</Button>
        </TabsContent>
        <TabsContent value="drafts" className="space-y-2">
          {drafts.isFetching && <p className="text-sm text-muted-foreground" role="status">Cargando borradores…</p>}
          {drafts.isError && <p className="text-sm text-destructive" role="alert">No se pudieron cargar los borradores.</p>}
          {drafts.isSuccess && !drafts.data?.length && <p className="text-sm text-muted-foreground">No hay comprobantes pendientes de revisar.</p>}
          {!!drafts.data?.length && (
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {drafts.data.map((item) => (
                <li key={item.id}>
                  <button type="button" className="w-full break-words rounded-md border p-2 text-left text-sm hover:bg-muted"
                    onClick={() => setDraft(item)}>
                    {item.pdf_name || item.message_subject || "Comprobante importado"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
      {prepare.isPending && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Leyendo el comprobante…
        </p>
      )}
      {prepare.error && <p className="text-sm text-destructive" role="alert">{prepare.error.message}</p>}
    </div>
  );
}
