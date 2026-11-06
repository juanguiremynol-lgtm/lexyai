import { describe, expect, it } from "vitest";
import { storedReadDetail, timelinePresentation } from "../sync-timeline-presentation";

describe("timeline evidence presentation", () => {
  it("never shows unresolved providers or contradictory errors as successful", () => {
    for (const provider of ["publicaciones", "unknown", "none"]) {
      expect(timelinePresentation({status:"success",provider,error_code:"PROVIDER_UNRESOLVED"})).toBe("unverified");
    }
    expect(timelinePresentation({status:"success",provider:"unknown",error_code:null})).toBe("unverified");
    expect(timelinePresentation({status:"success",provider:"publicaciones",error_code:null,
      metadata:{source_complete:false}})).toBe("unverified");
    expect(timelinePresentation({status:"success",provider:"publicaciones",error_code:null})).toBe("success");
  });
  it("separates an unverified empty read and a duplicate request from an observed empty result", () => {
    expect(timelinePresentation({status:"empty",provider:"publicaciones",error_code:null})).toBe("unverified");
    expect(timelinePresentation({status:"empty",provider:"publicaciones",error_code:null,metadata:{source_complete:true}})).toBe("empty");
    expect(timelinePresentation({status:"deduplicated",provider:"publicaciones",error_code:"PP_STORED_READ_INCOMPLETE"})).toBe("deduplicated");
    expect(timelinePresentation({status:"future-status",provider:"publicaciones",error_code:null})).toBe("unverified");
  });
  it("explains a recorded partial-document reason without inventing a diagnosis", () => {
    expect(storedReadDetail({stored_result_read:{reason:"PP_RUN_PARCIAL: ESTADO_SIN_DOCUMENTO"}}))
      .toContain("No se recuperó");
    expect(storedReadDetail({stored_result_read:{reason:"unrecognized"}})).toBeNull();
  });
});
