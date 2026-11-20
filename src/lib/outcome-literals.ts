/**
 * outcome-literals — LT3. The instrument that catches an UNDECLARED value.
 *
 * A list-auditor compares a declared list against its uses and can only find an
 * INCOMPLETE declaration. It cannot find a value that was never declared at
 * all — which is how `SOURCE_RETENTION_EXPIRED` reached production as a
 * terminal outcome no vocabulary knew about.
 *
 * The shape that catches it is the inverse: start from the code, not from the
 * declaration. Collect every literal the code ASSIGNS to an outcome column
 * (`error_code`, `result_code`, `last_error`), keep only those the code also
 * BRANCHES on — a value only written and read by a human is documentation, a
 * value compared in a branch is a vocabulary — and diff that set against
 * `sync_vocabulary`, case-sensitively.
 */

import ts from "typescript";

/** Persisted outcomes and the corresponding write-RPC parameters. */
export const OUTCOME_FIELDS = ["error_code", "result_code", "last_error", "last_error_code", "p_error_code", "_error_code", "_result_code"] as const;

const outcomeFields = new Set<string>(OUTCOME_FIELDS);

function fieldName(node: ts.Node): string | undefined {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return undefined;
}

function collectValue(node: ts.Expression, values: Set<string>) {
  if (ts.isStringLiteralLike(node) && /^[A-Z][A-Z0-9_]{2,}$/.test(node.text)) values.add(node.text);
  else if (ts.isConditionalExpression(node)) {
    collectValue(node.whenTrue, values);
    collectValue(node.whenFalse, values);
  } else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) {
    collectValue(node.left, values);
    collectValue(node.right, values);
  } else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) collectValue(node.expression, values);
}

function collectFieldValues(fileName: string, source: string, values: Set<string>) {
  if (!OUTCOME_FIELDS.some(field => source.includes(field))) return;
  // Parse the value expression only. A neighbouring status, retry kind or
  // ternary condition on the same line belongs to a different vocabulary.
  const ast = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest);
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && outcomeFields.has(fieldName(node.name) ?? "")) collectValue(node.initializer, values);
    if (ts.isBinaryExpression(node) && outcomeFields.has(fieldName(node.left) ?? "") &&
        [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind)) {
      collectValue(node.right, values);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}

/** A literal the code decides on: comparison, switch case, or membership test. */
const COMPARISON_RES = [
  /[=!]==?\s*['"`]([A-Z][A-Z0-9_]{2,})['"`]/g,
  /['"`]([A-Z][A-Z0-9_]{2,})['"`]\s*[=!]==?/g,
  /case\s+['"`]([A-Z][A-Z0-9_]{2,})['"`]/g,
  /includes\(\s*['"`]([A-Z][A-Z0-9_]{2,})['"`]/g,
  /\bIN\s*\(\s*['"`]([A-Z][A-Z0-9_]{2,})['"`]/gi,
];

/** Literals that are not outcomes even though they are shaped like one. */
const NOT_OUTCOMES = new Set([
  "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD",
  "UTC", "JSON", "HTML", "TEXT", "NULL", "TRUE", "FALSE",
  "ACTUACIONES", "ESTADOS", "SUCCESS", "ERROR",
]);

function collect(re: RegExp, source: string, into: Set<string>) {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) into.add(m[1]);
}

export interface OutcomeScan {
  /** Literals assigned to an outcome column anywhere in the scanned sources. */
  assigned: Set<string>;
  /** Literals the code branches on. */
  compared: Set<string>;
  /** Assigned AND compared — these decide, and must be declared. */
  deciding: string[];
}

export function scanOutcomeLiterals(sources: { fileName: string; text: string }[]): OutcomeScan {
  const assigned = new Set<string>();
  const compared = new Set<string>();

  for (const { fileName, text } of sources) {
    collectFieldValues(fileName, text, assigned);
    for (const re of COMPARISON_RES) collect(re, text, compared);
  }

  const deciding = [...assigned]
    .filter((v) => !NOT_OUTCOMES.has(v) && compared.has(v))
    .sort();

  return { assigned, compared, deciding };
}

/** Case-sensitive diff. `pending_upstream` does NOT declare `PENDING_UPSTREAM`. */
export function undeclaredOutcomes(deciding: string[], declared: string[]): string[] {
  const set = new Set(declared);
  return deciding.filter((v) => !set.has(v)).sort();
}
