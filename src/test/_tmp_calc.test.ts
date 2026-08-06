import { describe, it } from "vitest";
import { addBusinessDays } from "@/lib/colombian-holidays";
describe("calc", () => { it("x", () => {
  console.log("fijacion 2026-08-03 -> notif", addBusinessDays(new Date("2026-08-03T00:00:00"),1).toISOString().slice(0,10));
  console.log("10bd from 2026-08-04:", addBusinessDays(new Date("2026-08-04T00:00:00"),10).toISOString().slice(0,10));
  console.log("10bd from 2026-08-03:", addBusinessDays(new Date("2026-08-03T00:00:00"),10).toISOString().slice(0,10));
});});
