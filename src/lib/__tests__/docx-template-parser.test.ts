/**
 * Tests for DOCX template parser — placeholder extraction, run-splitting,
 * conditional blocks, and validation.
 */

import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  parseDocxTemplate,
  validateTokensAgainstSchema,
  generateDocxFromTemplate,
  computeSha256,
} from "../docx-template-parser";
import { getDocTypeSchema } from "../docx-template-schema";

// ─── Helper: create a minimal DOCX from XML content ─────

async function createDocx(documentXml: string, headers?: Record<string, string>, footers?: Record<string, string>): Promise<ArrayBuffer> {
  const zip = new JSZip();

  // Minimal [Content_Types].xml
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="xml" ContentType="application/xml"/>
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`);

  // Minimal rels
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`);

  zip.file("word/document.xml", documentXml);

  if (headers) {
    for (const [name, content] of Object.entries(headers)) {
      zip.file(`word/${name}`, content);
    }
  }

  if (footers) {
    for (const [name, content] of Object.entries(footers)) {
      zip.file(`word/${name}`, content);
    }
  }

  const blob = await zip.generateAsync({ type: "arraybuffer" });
  return blob;
}

function wrapInDoc(paragraphs: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>${paragraphs}</w:body>
    </w:document>`;
}

function makeParagraph(...runs: string[]): string {
  const runsXml = runs.map(r => `<w:r><w:t xml:space="preserve">${r}</w:t></w:r>`).join("");
  return `<w:p>${runsXml}</w:p>`;
}

// ─── Tests ───────────────────────────────────────────────

describe("Placeholder extraction", () => {
  it("extracts a placeholder fully inside one run", async () => {
    const xml = wrapInDoc(makeParagraph("Yo, {{CLIENT_FULL_NAME}}, acepto."));
    const buffer = await createDocx(xml);
    const { tokens } = await parseDocxTemplate(buffer);

    expect(tokens.length).toBe(1);
    expect(tokens[0].key).toBe("CLIENT_FULL_NAME");
    expect(tokens[0].type).toBe("placeholder");
    expect(tokens[0].isValid).toBe(true);
    expect(tokens[0].location).toBe("body");
  });

  it("extracts a placeholder split across multiple runs", async () => {
    const xml = wrapInDoc(makeParagraph("Yo, {{LAW", "YER_FULL", "_NAME}}, acepto."));
    const buffer = await createDocx(xml);
    const { tokens } = await parseDocxTemplate(buffer);

    expect(tokens.length).toBe(1);
    expect(tokens[0].key).toBe("LAWYER_FULL_NAME");
    expect(tokens[0].isValid).toBe(true);
  });

  it("extracts multiple placeholders in one paragraph", async () => {
    const xml = wrapInDoc(
      makeParagraph("{{CLIENT_FULL_NAME}} con CC {{CLIENT_ID_NUMBER}}")
    );
    const buffer = await createDocx(xml);
    const { tokens } = await parseDocxTemplate(buffer);

    expect(tokens.length).toBe(2);
    expect(tokens.map(t => t.key).sort()).toEqual(["CLIENT_FULL_NAME", "CLIENT_ID_NUMBER"]);
  });

  it("extracts placeholders from headers and footers", async () => {
    const bodyXml = wrapInDoc(makeParagraph("Body text"));
    const headerXml = wrapInDoc(makeParagraph("Header: {{LAW_FIRM_NAME}}"));
    const footerXml = wrapInDoc(makeParagraph("Footer: {{DATE}}"));

    const buffer = await createDocx(bodyXml, { "header1.xml": headerXml }, { "footer1.xml": footerXml });
    const { tokens } = await parseDocxTemplate(buffer);

    expect(tokens.length).toBe(2);
    const headerToken = tokens.find(t => t.location === "header");
    const footerToken = tokens.find(t => t.location === "footer");
    expect(headerToken?.key).toBe("LAW_FIRM_NAME");
    expect(footerToken?.key).toBe("DATE");
  });

  it("extracts placeholders from table cells", async () => {
    const tableXml = `
      <w:tbl>
        <w:tr>
          <w:tc>
            ${makeParagraph("{{CITY}}")}
          </w:tc>
          <w:tc>
            ${makeParagraph("{{DATE}}")}
          </w:tc>
        </w:tr>
      </w:tbl>`;
    const xml = wrapInDoc(tableXml);
    const buffer = await createDocx(xml);
    const { tokens } = await parseDocxTemplate(buffer);

    expect(tokens.length).toBe(2);
    expect(tokens.map(t => t.key).sort()).toEqual(["CITY", "DATE"]);
  });

  it("marks malformed tokens as invalid", async () => {
    const xml = wrapInDoc(
      makeParagraph("{{invalid key}}", "{{NOMBRE_CLIENTÉ}}", "{{VALID_KEY}}")
    );
    const buffer = await createDocx(xml);
    const { tokens } = await parseDocxTemplate(buffer);

    const invalid = tokens.filter(t => !t.isValid);
    const valid = tokens.filter(t => t.isValid);
    expect(invalid.length).toBe(2);
    expect(valid.length).toBe(1);
    expect(valid[0].key).toBe("VALID_KEY");
  });
});

describe("Conditional block extraction", () => {
  it("extracts IF blocks", async () => {
    const xml = wrapInDoc(
      makeParagraph("{{#IF RADICADO_NUMBER}}Radicado: {{RADICADO_NUMBER}}{{/IF}}")
    );
    const buffer = await createDocx(xml);
    const { tokens } = await parseDocxTemplate(buffer);

    const ifOpen = tokens.find(t => t.type === "if_open");
    const ifClose = tokens.find(t => t.type === "if_close");
    const placeholder = tokens.find(t => t.type === "placeholder");

    expect(ifOpen).toBeDefined();
    expect(ifOpen?.key).toBe("RADICADO_NUMBER");
    expect(ifClose).toBeDefined();
    expect(placeholder?.key).toBe("RADICADO_NUMBER");
  });
});

describe("Schema validation", () => {
  it("blocks activation when required placeholders are missing", async () => {
    const xml = wrapInDoc(
      makeParagraph("{{CLIENT_FULL_NAME}} {{CITY}}")
    );
    const buffer = await createDocx(xml);
    const { tokens } = await parseDocxTemplate(buffer);
    const schema = getDocTypeSchema("contrato_servicios");
    const result = validateTokensAgainstSchema(tokens, schema);

    expect(result.can_activate).toBe(false);
    expect(result.missing_required_placeholders.length).toBeGreaterThan(0);
    expect(result.missing_required_placeholders).toContain("LAWYER_FULL_NAME");
  });

  it("warns on unknown placeholders but allows activation", async () => {
    const schema = getDocTypeSchema("contrato_servicios");
    // Create a DOCX with all required + some unknown
    const allRequired = schema.placeholders.required.map(p => `{{${p.key}}}`).join(" ");
    const xml = wrapInDoc(makeParagraph(allRequired + " {{CUSTOM_FIELD}}"));
    const buffer = await createDocx(xml);
    const { tokens } = await parseDocxTemplate(buffer);
    const result = validateTokensAgainstSchema(tokens, schema);

    expect(result.can_activate).toBe(true);
    expect(result.unknown_placeholders).toContain("CUSTOM_FIELD");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("all required placeholders present → valid", async () => {
    const schema = getDocTypeSchema("poder_especial");
    const allRequired = schema.placeholders.required.map(p => `{{${p.key}}}`).join(" ");
    const xml = wrapInDoc(makeParagraph(allRequired));
    const buffer = await createDocx(xml);
    const { tokens } = await parseDocxTemplate(buffer);
    const result = validateTokensAgainstSchema(tokens, schema);

    expect(result.can_activate).toBe(true);
    expect(result.missing_required_placeholders.length).toBe(0);
    expect(result.is_valid).toBe(true);
  });
});

describe("SHA-256 computation", () => {
  it("produces consistent hash", async () => {
    const data = new TextEncoder().encode("hello world").buffer;
    const hash = await computeSha256(data);
    expect(hash).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });
});

describe("DOCX generation with placeholder replacement", () => {
  it("replaces placeholders in generated document", async () => {
    const xml = wrapInDoc(
      makeParagraph("Yo, {{CLIENT_FULL_NAME}}, con CC {{CLIENT_ID_NUMBER}}")
    );
    const buffer = await createDocx(xml);
    const resultBlob = await generateDocxFromTemplate(buffer, {
      CLIENT_FULL_NAME: "Juan Pérez",
      CLIENT_ID_NUMBER: "123456",
    });

    // Read back the generated doc — convert Blob to ArrayBuffer for JSZip
    const resultBuffer = await resultBlob.arrayBuffer();
    const generatedZip = await JSZip.loadAsync(resultBuffer);
    const docXml = await generatedZip.file("word/document.xml")!.async("string");

    expect(docXml).toContain("Juan Pérez");
    expect(docXml).toContain("123456");
    expect(docXml).not.toContain("{{CLIENT_FULL_NAME}}");
    expect(docXml).not.toContain("{{CLIENT_ID_NUMBER}}");
  });

  it("preserves paragraphs without placeholders", async () => {
    const xml = wrapInDoc(
      makeParagraph("This is plain text.") +
      makeParagraph("{{CITY}} has placeholders")
    );
    const buffer = await createDocx(xml);
    const resultBlob = await generateDocxFromTemplate(buffer, { CITY: "Medellín" });

    const resultBuffer = await resultBlob.arrayBuffer();
    const generatedZip = await JSZip.loadAsync(resultBuffer);
    const docXml = await generatedZip.file("word/document.xml")!.async("string");

    expect(docXml).toContain("This is plain text.");
    expect(docXml).toContain("Medellín");
  });
});
