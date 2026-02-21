import { describe, it, expect } from "vitest";
import {
  getPostCreationDocOptions,
  type DocumentPolicyType,
} from "@/lib/document-policy";

describe("getPostCreationDocOptions", () => {
  it("returns contrato_servicios and poder_especial by default", () => {
    const options = getPostCreationDocOptions();
    const types = options.map((o) => o.docType);
    expect(types).toContain("contrato_servicios");
    expect(types).toContain("poder_especial");
    expect(types).toHaveLength(2);
  });

  it("excludes disabled doc types", () => {
    const options = getPostCreationDocOptions(["contrato_servicios"]);
    const types = options.map((o) => o.docType);
    expect(types).not.toContain("contrato_servicios");
    expect(types).toContain("poder_especial");
    expect(types).toHaveLength(1);
  });

  it("returns empty array when all eligible types are disabled", () => {
    const options = getPostCreationDocOptions([
      "contrato_servicios",
      "poder_especial",
    ]);
    expect(options).toHaveLength(0);
  });

  it("does not include non-eligible doc types like notificacion_personal", () => {
    const options = getPostCreationDocOptions();
    const types = options.map((o) => o.docType);
    expect(types).not.toContain("notificacion_personal");
    expect(types).not.toContain("notificacion_por_aviso");
    expect(types).not.toContain("paz_y_salvo");
  });

  it("each option has label_es and description_es", () => {
    const options = getPostCreationDocOptions();
    for (const opt of options) {
      expect(opt.label_es).toBeTruthy();
      expect(opt.description_es).toBeTruthy();
    }
  });

  it("ignores unknown types in disabledDocTypes gracefully", () => {
    const options = getPostCreationDocOptions([
      "fake_type" as DocumentPolicyType,
    ]);
    expect(options).toHaveLength(2);
  });
});
