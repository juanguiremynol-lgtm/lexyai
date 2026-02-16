import { describe, it, expect } from "vitest";
import {
  sanitizeCellValue,
  sanitizeRowForExport,
  sanitizeRowsForExport,
} from "@/lib/spreadsheet-sanitize";

describe("sanitizeCellValue", () => {
  it("prefixes strings starting with = with apostrophe", () => {
    expect(sanitizeCellValue("=HYPERLINK(\"http://evil\",\"CLICK\")")).toBe(
      "'=HYPERLINK(\"http://evil\",\"CLICK\")"
    );
  });

  it("prefixes strings starting with + with apostrophe", () => {
    expect(sanitizeCellValue("+cmd|'powershell'!A1")).toBe(
      "'+cmd|'powershell'!A1"
    );
  });

  it("prefixes strings starting with - with apostrophe", () => {
    expect(sanitizeCellValue("-1+1")).toBe("'-1+1");
  });

  it("prefixes strings starting with @ with apostrophe", () => {
    expect(sanitizeCellValue("@SUM(A1:A10)")).toBe("'@SUM(A1:A10)");
  });

  it("prefixes after left whitespace (spaces)", () => {
    expect(sanitizeCellValue("  =SUM(A1)")).toBe("'  =SUM(A1)");
  });

  it("prefixes after tab + formula char", () => {
    expect(sanitizeCellValue("\t=SUM(A1)")).toBe("'\t=SUM(A1)");
    expect(sanitizeCellValue("\t+cmd")).toBe("'\t+cmd");
  });

  it("prefixes after CRLF + formula char", () => {
    expect(sanitizeCellValue("\r\n=HYPERLINK()")).toBe("'\r\n=HYPERLINK()");
  });

  it("prefixes after mixed whitespace + formula char", () => {
    expect(sanitizeCellValue("  \t  @SUM")).toBe("'  \t  @SUM");
  });

  it("does not modify safe strings", () => {
    expect(sanitizeCellValue("Hello world")).toBe("Hello world");
    expect(sanitizeCellValue("Radicado 12345678901234567890123")).toBe(
      "Radicado 12345678901234567890123"
    );
    expect(sanitizeCellValue("")).toBe("");
  });

  it("passes through numbers unchanged", () => {
    expect(sanitizeCellValue(42)).toBe(42);
    expect(sanitizeCellValue(0)).toBe(0);
    expect(sanitizeCellValue(-5)).toBe(-5);
  });

  it("passes through null/undefined/boolean", () => {
    expect(sanitizeCellValue(null)).toBe(null);
    expect(sanitizeCellValue(undefined)).toBe(undefined);
    expect(sanitizeCellValue(true)).toBe(true);
  });
});

describe("sanitizeRowForExport", () => {
  it("sanitizes all string values in a row", () => {
    const row = {
      Radicado: "12345",
      Demandante: "=HYPERLINK(\"http://evil\",\"click\")",
      Monto: 1000,
      Activo: true,
    };
    const result = sanitizeRowForExport(row);
    expect(result.Radicado).toBe("12345");
    expect(result.Demandante).toBe("'=HYPERLINK(\"http://evil\",\"click\")");
    expect(result.Monto).toBe(1000);
    expect(result.Activo).toBe(true);
  });
});

describe("sanitizeRowsForExport", () => {
  it("sanitizes all rows", () => {
    const rows = [
      { Name: "Safe value", Formula: "=SUM(A1)" },
      { Name: "+evil", Formula: "Normal" },
    ];
    const result = sanitizeRowsForExport(rows);
    expect(result[0].Name).toBe("Safe value");
    expect(result[0].Formula).toBe("'=SUM(A1)");
    expect(result[1].Name).toBe("'+evil");
    expect(result[1].Formula).toBe("Normal");
  });
});
