import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireWriteScope, resolveWorkItem, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "add_note",
  title: "Agregar nota a un asunto",
  description:
    "Appends a timestamped note to a matter's notes field. This is the only write operation exposed over MCP: it never deletes, reclassifies, or changes the lifecycle of a matter.",
  inputSchema: {
    radicado: z
      .string()
      .trim()
      .optional()
      .describe("Radicado en cualquier forma: 23 dígitos, con guiones, con espacios, base de 21 dígitos, 22 dígitos sin cero inicial o base+instancia."),
    id: z.string().uuid().optional().describe("UUID del asunto."),
    content: z.string().trim().min(1).max(4000).describe("Texto de la nota."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ radicado, id, content }, ctx) => {
    const denied = requireWriteScope(ctx);
    if (denied) return errorResult(denied);
    const sb = sbForUser(ctx);

    const resolved = await resolveWorkItem(sb, { id, radicado }, "id, radicado, notes");
    const item = resolved.item;
    if (resolved.error || !item) return errorResult(resolved.error ?? "Asunto no encontrado.");

    const stamp = new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" });
    const entry = `[${stamp} · vía asistente IA] ${content}`;
    const previous = ((item.notes as string | null) ?? "").trim();
    const nextNotes = previous ? `${previous}\n\n${entry}` : entry;

    const { error: upErr } = await sb
      .from("work_items")
      .update({ notes: nextNotes, updated_at: new Date().toISOString() })
      .eq("id", item.id as string);
    if (upErr) return errorResult(upErr.message);

    return textResult(`${resolved.note ? `${resolved.note}\n` : ""}Nota agregada al asunto ${item.radicado ?? item.id}.`, {
      resolucion: resolved.note ?? null,
      work_item_id: item.id,
      note: entry,
    });
  },
});
