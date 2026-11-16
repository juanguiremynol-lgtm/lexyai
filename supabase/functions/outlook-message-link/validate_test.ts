import { assertEquals } from "jsr:@std/assert@1";
import { validateBody } from "./index.ts";
const W = "471b2dd7-cffd-441f-8293-55f39f7b51dd";
Deno.test("validation rejects malformed input", () => {
  assertEquals(validateBody({ action: "search", work_item_id: "x", folder: "inbox" }).ok, false);
  assertEquals(validateBody({ action: "search", work_item_id: W, folder: "drafts" }).ok, false);
  assertEquals(validateBody({ action: "link", work_item_id: W, message_id: "a b" }).ok, false);
  assertEquals(validateBody({ action: "purge", work_item_id: W }).ok, false);
  assertEquals(validateBody({ action: "search", work_item_id: W, folder: "sentitems", query: "x".repeat(121) }).ok, false);
});
Deno.test("validation accepts search without radicado and link by Graph id", () => {
  const s = validateBody({ action: "search", work_item_id: W, folder: "sentitems", query: 'CORNARE "x"' });
  assertEquals(s.ok && s.action === "search" && s.query, "CORNARE  x");
  assertEquals(validateBody({ action: "link", work_item_id: W, message_id: "AAMkAGI2TG93AAA=" }).ok, true);
});
