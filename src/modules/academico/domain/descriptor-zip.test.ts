import { describe, expect, it } from "vitest";

import { exceedsDescriptorUncompressedBudget, MAX_DESCRIPTOR_UNCOMPRESSED_BYTES } from "./descriptor-zip";

describe("exceedsDescriptorUncompressedBudget (guardia anti zip-bomb del descriptor SENCE)", () => {
  it("bajo el límite: no excede", () => {
    expect(exceedsDescriptorUncompressedBudget(MAX_DESCRIPTOR_UNCOMPRESSED_BYTES - 1)).toBe(false);
  });

  it("en el límite exacto: no excede", () => {
    expect(exceedsDescriptorUncompressedBudget(MAX_DESCRIPTOR_UNCOMPRESSED_BYTES)).toBe(false);
  });

  it("sobre el límite: excede", () => {
    expect(exceedsDescriptorUncompressedBudget(MAX_DESCRIPTOR_UNCOMPRESSED_BYTES + 1)).toBe(true);
  });
});
