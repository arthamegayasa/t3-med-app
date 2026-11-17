import { describe, expect, it } from "vite-plus/test";

import { THREAD_DETAILS_ITEMS } from "../components/chat/threadDetailsItems";
import { BRAND_WORD, showsThreadDetailsItem, T3MED } from "./t3med";

describe("the T3 Med switch", () => {
  it("is on, and names the app T3 Med", () => {
    expect(T3MED).toBe(true);
    expect(BRAND_WORD).toBe("Med");
  });

  it("leaves the coding rows out of the thread details menu, and nothing else", () => {
    // Upstream's own list after the gate. A row upstream adds shows up here to be decided on,
    // and a coding row whose id upstream changes would slip back in and fail this.
    expect(THREAD_DETAILS_ITEMS.map((item) => item.id)).toEqual([
      "environment",
      "servers",
      "automations",
      "lineage",
      "sideChats",
      "usage",
      "context",
    ]);
    for (const id of ["openIn", "scripts", "branch", "gitActions", "changes"]) {
      expect(showsThreadDetailsItem(id)).toBe(false);
    }
    expect(showsThreadDetailsItem("sideChats")).toBe(true);
  });
});
