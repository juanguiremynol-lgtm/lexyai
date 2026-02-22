/**
 * DOCX Template Parser — extracts placeholders from DOCX files,
 * handles Word run-splitting, and validates against canonical schema.
 *
 * Uses JSZip (already installed) to read DOCX internals.
 */

import JSZip from "jszip";
import {
  type DocTypeSchema,
  type ValidationResult,
  getAllSchemaKeys,
  PLACEHOLDER_KEY_REGEX,
} from "./docx-template-schema";

export type { ValidationResult };

// ─── Types ───────────────────────────────────────────────

interface RunMapping {
  startIdx: number;
  endIdx: number;
  nodeRef: string; // e.g. "paragraph-3/run-1/text-0"
}

interface ExtractedToken {
  raw: string;
  key: string;
  type: "placeholder" | "if_open" | "if_close";
  location: string; // body, header, footer
  isValid: boolean;
  error?: string;
}

// ─── XML Text Extraction with Run-Splitting Handling ─────

/**
 * Reconstruct logical text from DOCX XML by concatenating all w:t text nodes
 * within each paragraph. This handles Word's run-splitting where a placeholder
 * like {{LAWYER_FULL_NAME}} might be split across multiple <w:r><w:t> nodes.
 */
function extractTextFromXml(xml: string): string[] {
  // Extract all paragraphs
  const paragraphs: string[] = [];
  const paraRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;
  let paraMatch: RegExpExecArray | null;

  while ((paraMatch = paraRegex.exec(xml)) !== null) {
    const paraXml = paraMatch[0];
    // Extract all text nodes within this paragraph
    const textRegex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
    let textMatch: RegExpExecArray | null;
    let fullText = "";

    while ((textMatch = textRegex.exec(paraXml)) !== null) {
      fullText += textMatch[1];
    }

    if (fullText) {
      paragraphs.push(fullText);
    }
  }

  return paragraphs;
}

/**
 * Also extract text from table cells (w:tc) which may have their own paragraphs.
 * The paragraph extraction above already handles this since w:tc contains w:p.
 * But we want to ensure we don't miss any text outside paragraphs.
 */
function extractAllText(xml: string): string {
  const textRegex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let match: RegExpExecArray | null;
  let fullText = "";

  while ((match = textRegex.exec(xml)) !== null) {
    fullText += match[1];
  }

  return fullText;
}

// ─── Token Extraction ────────────────────────────────────

/**
 * Extract all placeholder tokens from a text string.
 * Supports: {{KEY}}, {{#IF KEY}}, {{/IF}}
 * Normalizes whitespace inside braces.
 */
function extractTokensFromText(text: string, location: string): ExtractedToken[] {
  const tokens: ExtractedToken[] = [];

  // Match all {{...}} patterns (greedy for inner content)
  const tokenRegex = /\{\{([\s\S]*?)\}\}/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    const raw = match[0];
    const inner = match[1].trim();

    // Check for conditional open: {{#IF KEY}}
    const ifOpenMatch = inner.match(/^#IF\s+(\S+)$/i);
    if (ifOpenMatch) {
      const key = ifOpenMatch[1].toUpperCase();
      const isValid = PLACEHOLDER_KEY_REGEX.test(key);
      tokens.push({
        raw,
        key,
        type: "if_open",
        location,
        isValid,
        error: isValid ? undefined : `Clave condicional inválida: ${key}`,
      });
      continue;
    }

    // Check for conditional close: {{/IF}}
    if (/^\/IF$/i.test(inner)) {
      tokens.push({ raw, key: "", type: "if_close", location, isValid: true });
      continue;
    }

    // Regular placeholder: {{KEY}}
    const key = inner.toUpperCase();
    const hasSpaces = inner !== inner.trim() || /\s/.test(inner.trim());
    const isValidKey = PLACEHOLDER_KEY_REGEX.test(key);

    tokens.push({
      raw,
      key,
      type: "placeholder",
      location,
      isValid: isValidKey && !hasSpaces,
      error: !isValidKey
        ? `Clave inválida "${inner}" — solo se permiten letras mayúsculas, números y guiones bajos`
        : hasSpaces
        ? `Espacios dentro de las llaves: "${inner}" (use {{${key}}} en su lugar)`
        : undefined,
    });
  }

  return tokens;
}

// ─── Main Parser ─────────────────────────────────────────

/**
 * Parse a DOCX file (as ArrayBuffer) and extract all placeholder tokens.
 */
export async function parseDocxTemplate(
  fileBuffer: ArrayBuffer,
): Promise<{
  tokens: ExtractedToken[];
  xmlParts: string[];
}> {
  const zip = await JSZip.loadAsync(fileBuffer);
  const xmlParts: string[] = [];
  const allTokens: ExtractedToken[] = [];

  // Parts to scan
  const partsToScan: { pattern: string; location: string }[] = [
    { pattern: "word/document.xml", location: "body" },
  ];

  // Dynamically find headers and footers
  for (const filename of Object.keys(zip.files)) {
    if (/^word\/header\d*\.xml$/.test(filename)) {
      partsToScan.push({ pattern: filename, location: "header" });
    }
    if (/^word\/footer\d*\.xml$/.test(filename)) {
      partsToScan.push({ pattern: filename, location: "footer" });
    }
    if (filename === "word/footnotes.xml") {
      partsToScan.push({ pattern: filename, location: "footnotes" });
    }
  }

  for (const { pattern, location } of partsToScan) {
    const file = zip.file(pattern);
    if (!file) continue;

    const xmlContent = await file.async("string");
    xmlParts.push(xmlContent);

    // Strategy: reconstruct full text per paragraph to handle run-splitting
    const fullText = extractAllText(xmlContent);
    const tokens = extractTokensFromText(fullText, location);
    allTokens.push(...tokens);
  }

  return { tokens: allTokens, xmlParts };
}

// ─── Validation ──────────────────────────────────────────

/**
 * Validate extracted tokens against a doc type schema.
 */
export function validateTokensAgainstSchema(
  tokens: ExtractedToken[],
  schema: DocTypeSchema,
): ValidationResult {
  const allSchemaKeys = getAllSchemaKeys(schema);
  const requiredKeys = new Set(schema.placeholders.required.map(p => p.key));

  const placeholdersFound = [
    ...new Set(tokens.filter(t => t.type === "placeholder" && t.isValid).map(t => t.key)),
  ];
  const conditionalBlocksFound = [
    ...new Set(tokens.filter(t => t.type === "if_open" && t.isValid).map(t => t.key)),
  ];
  const invalidTokens = tokens.filter(t => !t.isValid).map(t => t.raw + (t.error ? ` (${t.error})` : ""));

  const missingRequired = [...requiredKeys].filter(k => !placeholdersFound.includes(k));
  const unknownPlaceholders = placeholdersFound.filter(k => !allSchemaKeys.includes(k));

  const warnings: string[] = [];
  const errors: string[] = [];

  if (unknownPlaceholders.length > 0) {
    warnings.push(
      `Placeholders desconocidos: ${unknownPlaceholders.join(", ")}. No se sustituirán automáticamente.`,
    );
  }

  if (missingRequired.length > 0) {
    errors.push(
      `Faltan placeholders requeridos: ${missingRequired.join(", ")}`,
    );
  }

  if (invalidTokens.length > 0) {
    errors.push(
      `Tokens inválidos encontrados: ${invalidTokens.join("; ")}`,
    );
  }

  // Check for unmatched IF blocks
  let ifDepth = 0;
  for (const t of tokens) {
    if (t.type === "if_open") ifDepth++;
    if (t.type === "if_close") ifDepth--;
    if (ifDepth < 0) {
      errors.push("{{/IF}} sin {{#IF}} correspondiente");
      break;
    }
  }
  if (ifDepth > 0) {
    errors.push(`${ifDepth} bloque(s) {{#IF}} sin cerrar`);
  }

  const canActivate = missingRequired.length === 0 && invalidTokens.length === 0;

  return {
    placeholders_found: placeholdersFound,
    missing_required_placeholders: missingRequired,
    unknown_placeholders: unknownPlaceholders,
    invalid_tokens: invalidTokens,
    conditional_blocks_found: conditionalBlocksFound,
    is_valid: errors.length === 0,
    can_activate: canActivate,
    warnings,
    errors,
  };
}

// ─── DOCX Generation (placeholder replacement) ──────────

/**
 * Replace placeholders in a DOCX file and return the modified DOCX as a Blob.
 * Handles run-splitting by reconstructing paragraph text.
 */
export async function generateDocxFromTemplate(
  templateBuffer: ArrayBuffer,
  values: Record<string, string>,
): Promise<Blob> {
  const zip = await JSZip.loadAsync(templateBuffer);

  const partsToProcess = ["word/document.xml"];
  for (const filename of Object.keys(zip.files)) {
    if (/^word\/(header|footer)\d*\.xml$/.test(filename)) {
      partsToProcess.push(filename);
    }
  }

  for (const partName of partsToProcess) {
    const file = zip.file(partName);
    if (!file) continue;

    let xmlContent = await file.async("string");
    xmlContent = replaceInXml(xmlContent, values);
    zip.file(partName, xmlContent);
  }

  return await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

/**
 * Replace placeholders in XML content by reconstructing paragraph text,
 * then writing it back as a single run per paragraph (where placeholders exist).
 */
function replaceInXml(xml: string, values: Record<string, string>): string {
  // Process conditional blocks first
  xml = processConditionalBlocks(xml, values);

  // Then replace placeholders within paragraphs
  const paraRegex = /(<w:p[\s>])([\s\S]*?)(<\/w:p>)/g;

  return xml.replace(paraRegex, (fullMatch, openTag, innerContent, closeTag) => {
    // Extract all text from this paragraph
    const textRegex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
    let match: RegExpExecArray | null;
    let fullText = "";

    while ((match = textRegex.exec(innerContent)) !== null) {
      fullText += match[1];
    }

    // Check if paragraph contains any placeholders
    if (!/\{\{[A-Z0-9_]+\}\}/.test(fullText)) {
      return fullMatch; // No changes needed — preserve original formatting
    }

    // Replace placeholders in the reconstructed text
    let replacedText = fullText;
    for (const [key, value] of Object.entries(values)) {
      replacedText = replacedText.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value || "");
    }

    // Extract paragraph properties (w:pPr) to preserve
    const pPrMatch = innerContent.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
    const pPr = pPrMatch ? pPrMatch[0] : "";

    // Extract first run's properties (w:rPr) for formatting
    const rPrMatch = innerContent.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
    const rPr = rPrMatch ? rPrMatch[0] : "";

    // Rebuild paragraph with single run containing replaced text
    const escapedText = escapeXml(replacedText);
    return `${openTag}${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapedText}</w:t></w:r>${closeTag}`;
  });
}

/**
 * Process {{#IF KEY}}...{{/IF}} conditional blocks in XML.
 * If KEY is empty/missing, remove entire block. Otherwise keep content and remove tags.
 */
function processConditionalBlocks(xml: string, values: Record<string, string>): string {
  // We need to handle conditionals that may span multiple paragraphs.
  // Strategy: work on the reconstructed text level, but since we're in XML,
  // we'll do a simpler approach: find IF blocks in the text content.

  // First, reconstruct full text to find IF block boundaries
  let result = xml;
  let changed = true;
  let iterations = 0;

  while (changed && iterations < 50) {
    changed = false;
    iterations++;

    // Find the innermost IF block (no nested IFs inside)
    const ifRegex = /\{\{#IF\s+([A-Z0-9_]+)\}\}([\s\S]*?)\{\{\/IF\}\}/i;

    // We need to search in the text content, but replace in the XML
    // Reconstruct text to find patterns
    const textContent = extractAllTextFromXml(result);
    const ifMatch = ifRegex.exec(textContent);

    if (ifMatch) {
      const key = ifMatch[1].toUpperCase();
      const hasValue = values[key]?.trim();

      if (hasValue) {
        // Keep content, remove IF tags
        result = removeIfTagsFromXml(result, `{{#IF ${ifMatch[1]}}}`, "{{/IF}}");
      } else {
        // Remove entire block including content between IF tags
        result = removeIfBlockFromXml(result, `{{#IF ${ifMatch[1]}}}`, "{{/IF}}");
      }
      changed = true;
    }
  }

  return result;
}

function extractAllTextFromXml(xml: string): string {
  const textRegex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let match: RegExpExecArray | null;
  let result = "";
  while ((match = textRegex.exec(xml)) !== null) {
    result += match[1];
  }
  return result;
}

function removeIfTagsFromXml(xml: string, openTag: string, closeTag: string): string {
  // Remove the text content of the IF tags from w:t nodes
  let result = xml;
  result = removeTextTokenFromXml(result, openTag);
  result = removeTextTokenFromXml(result, closeTag);
  return result;
}

function removeIfBlockFromXml(xml: string, openTag: string, closeTag: string): string {
  // Find the paragraphs containing the open and close tags and remove everything between
  // Simple approach: remove the tokens and any paragraphs between them that are fully enclosed
  let result = xml;

  // For now, just remove the tags and their content at the text level
  // by removing text between open and close tags across w:t nodes
  const fullText = extractAllTextFromXml(result);
  const openIdx = fullText.indexOf(openTag);
  const closeIdx = fullText.indexOf(closeTag, openIdx);

  if (openIdx === -1 || closeIdx === -1) return result;

  // The content to remove is from openTag start to closeTag end
  const contentToRemove = fullText.substring(openIdx, closeIdx + closeTag.length);

  // Remove each character from the XML w:t nodes
  // Simple: replace in the reconstructed text then rebuild
  // Since this is complex with XML, we use a simpler string-based approach
  // Remove the open tag, close tag, and blank out content between them
  result = removeTextTokenFromXml(result, openTag);
  result = removeTextTokenFromXml(result, closeTag);

  // Remove the inner content
  const innerContent = fullText.substring(openIdx + openTag.length, closeIdx);
  if (innerContent.trim()) {
    result = removeTextTokenFromXml(result, innerContent);
  }

  return result;
}

function removeTextTokenFromXml(xml: string, token: string): string {
  // Remove a text token that may be split across multiple w:t nodes
  let remaining = token;
  let result = xml;

  const textRegex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let match: RegExpExecArray | null;
  let offset = 0;

  // eslint-disable-next-line no-constant-condition
  while (remaining.length > 0) {
    textRegex.lastIndex = offset;
    match = textRegex.exec(result);
    if (!match) break;

    const textContent = match[1];
    const idx = textContent.indexOf(remaining.substring(0, Math.min(remaining.length, textContent.length)));

    if (idx !== -1) {
      const removeLen = Math.min(remaining.length, textContent.length - idx);
      const newText = textContent.substring(0, idx) + textContent.substring(idx + removeLen);
      const fullTag = match[0].replace(textContent, newText);
      result = result.substring(0, match.index) + fullTag + result.substring(match.index + match[0].length);
      remaining = remaining.substring(removeLen);
    }

    offset = match.index + 1;
    if (offset >= result.length) break;
  }

  return result;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─── SHA-256 Hash ────────────────────────────────────────

export async function computeSha256(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}
