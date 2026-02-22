/**
 * HearingTypeEditModal — Add/Edit hearing type
 */
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { JURISDICTIONS, JURISDICTION_LABELS, type HearingType } from "@/hooks/use-hearing-catalog";

const schema = z.object({
  jurisdiction: z.string().min(1, "Requerido"),
  process_subtype: z.string().optional(),
  name: z.string().min(1, "Requerido"),
  short_name: z.string().min(1, "Requerido"),
  aliases: z.string().optional(),
  legal_basis: z.string().optional(),
  default_stage_order: z.coerce.number().int().min(0),
  typical_purpose: z.string().optional(),
  typical_outputs: z.string().optional(),
  typical_duration_minutes: z.coerce.number().int().min(0).optional(),
  is_mandatory: z.boolean(),
  is_active: z.boolean(),
  description: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  hearingType?: HearingType | null;
  onSave: (data: any) => Promise<void>;
  saving?: boolean;
}

export function HearingTypeEditModal({ open, onOpenChange, hearingType, onSave, saving }: Props) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      jurisdiction: "",
      process_subtype: "",
      name: "",
      short_name: "",
      aliases: "",
      legal_basis: "",
      default_stage_order: 0,
      typical_purpose: "",
      typical_outputs: "",
      typical_duration_minutes: undefined,
      is_mandatory: true,
      is_active: true,
      description: "",
    },
  });

  useEffect(() => {
    if (hearingType) {
      form.reset({
        jurisdiction: hearingType.jurisdiction,
        process_subtype: hearingType.process_subtype || "",
        name: hearingType.name,
        short_name: hearingType.short_name,
        aliases: (hearingType.aliases || []).join(", "),
        legal_basis: hearingType.legal_basis || "",
        default_stage_order: hearingType.default_stage_order,
        typical_purpose: hearingType.typical_purpose || "",
        typical_outputs: (hearingType.typical_outputs || []).join(", "),
        typical_duration_minutes: hearingType.typical_duration_minutes ?? undefined,
        is_mandatory: hearingType.is_mandatory,
        is_active: hearingType.is_active,
        description: hearingType.description || "",
      });
    } else {
      form.reset({
        jurisdiction: "",
        process_subtype: "",
        name: "",
        short_name: "",
        aliases: "",
        legal_basis: "",
        default_stage_order: 0,
        typical_purpose: "",
        typical_outputs: "",
        typical_duration_minutes: undefined,
        is_mandatory: true,
        is_active: true,
        description: "",
      });
    }
  }, [hearingType, open]);

  const handleSubmit = async (values: FormValues) => {
    const payload = {
      ...values,
      aliases: values.aliases ? values.aliases.split(",").map(a => a.trim()).filter(Boolean) : [],
      typical_outputs: values.typical_outputs ? values.typical_outputs.split(",").map(a => a.trim()).filter(Boolean) : [],
      process_subtype: values.process_subtype || null,
      typical_duration_minutes: values.typical_duration_minutes || null,
      description: values.description || null,
      legal_basis: values.legal_basis || null,
      typical_purpose: values.typical_purpose || null,
    };
    await onSave(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-black border-white/10 text-white">
        <DialogHeader>
          <DialogTitle className="text-white">
            {hearingType ? "Editar tipo de audiencia" : "Nuevo tipo de audiencia"}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="jurisdiction" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/70">Jurisdicción *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="bg-white/5 border-white/10 text-white">
                        <SelectValue placeholder="Seleccionar" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {JURISDICTIONS.map(j => (
                        <SelectItem key={j} value={j}>{JURISDICTION_LABELS[j]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="process_subtype" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/70">Subtipo de proceso</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="ej: declarativo, ejecutivo" className="bg-white/5 border-white/10 text-white" />
                  </FormControl>
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white/70">Nombre completo *</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Audiencia Inicial (Art. 372 CGP)" className="bg-white/5 border-white/10 text-white" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="short_name" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/70">Nombre corto *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Audiencia Inicial" className="bg-white/5 border-white/10 text-white" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="legal_basis" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/70">Base legal</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Art. 372 CGP" className="bg-white/5 border-white/10 text-white" />
                  </FormControl>
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="aliases" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white/70">Alias (separados por coma)</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="audiencia del 372, audiencia de saneamiento" className="bg-white/5 border-white/10 text-white" />
                </FormControl>
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="default_stage_order" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/70">Orden en flujo *</FormLabel>
                  <FormControl>
                    <Input {...field} type="number" className="bg-white/5 border-white/10 text-white" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="typical_duration_minutes" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/70">Duración típica (min)</FormLabel>
                  <FormControl>
                    <Input {...field} type="number" className="bg-white/5 border-white/10 text-white" />
                  </FormControl>
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white/70">Descripción</FormLabel>
                <FormControl>
                  <Textarea {...field} rows={2} className="bg-white/5 border-white/10 text-white" />
                </FormControl>
              </FormItem>
            )} />

            <FormField control={form.control} name="typical_purpose" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white/70">Propósito típico</FormLabel>
                <FormControl>
                  <Textarea {...field} rows={2} className="bg-white/5 border-white/10 text-white" />
                </FormControl>
              </FormItem>
            )} />

            <FormField control={form.control} name="typical_outputs" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white/70">Productos típicos (separados por coma)</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="auto_interlocutorio, acta, grabacion" className="bg-white/5 border-white/10 text-white" />
                </FormControl>
              </FormItem>
            )} />

            <div className="flex items-center gap-6">
              <FormField control={form.control} name="is_mandatory" render={({ field }) => (
                <FormItem className="flex items-center gap-2">
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <Label className="text-white/70 !mt-0">Obligatoria</Label>
                </FormItem>
              )} />
              <FormField control={form.control} name="is_active" render={({ field }) => (
                <FormItem className="flex items-center gap-2">
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <Label className="text-white/70 !mt-0">Activa</Label>
                </FormItem>
              )} />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="border-white/10 text-white/70">
                Cancelar
              </Button>
              <Button type="submit" disabled={saving} className="bg-cyan-500 hover:bg-cyan-600 text-black">
                {saving ? "Guardando..." : hearingType ? "Actualizar" : "Crear"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
