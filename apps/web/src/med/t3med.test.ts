import { describe, expect, it } from "vite-plus/test";

import { BRAND_WORD, T3MED } from "./t3med";

describe("the T3 Med switch", () => {
  it("is on, and names the app T3 Med", () => {
    expect(T3MED).toBe(true);
    expect(BRAND_WORD).toBe("Med");
  });
});
