import { emptyReadPersistence } from "./emptyReadPersistence.ts";

Deno.test("complete zero-row reads use a valid success enum and clear failures; partial reads retain their cause", () => {
  const complete = emptyReadPersistence(false, 4);
  if (complete.scrape_status !== "SUCCESS" || complete.last_error_code !== null || complete.consecutive_failures !== 0) {
    throw new Error("A complete empty read must persist successfully without a failure badge");
  }
  const partial = emptyReadPersistence(true, 4);
  if (partial.scrape_status !== "PARTIAL_SUCCESS" || partial.last_error_code !== "PARTIAL_SOURCE" || partial.consecutive_failures !== 5) {
    throw new Error("An incomplete read must not be certified or clear its known failure");
  }
});
