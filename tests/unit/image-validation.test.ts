import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, validateImageLike } from "@/lib/files/image-validation";

describe("image validation", () => {
  it("accepts PNG, JPEG, and WebP inputs", () => {
    expect(validateImageLike({ name: "card.png", type: "image/png", size: 1024 }).extension).toBe("png");
    expect(validateImageLike({ name: "coin.jpg", type: "image/jpeg", size: 1024 }).extension).toBe("jpg");
    expect(validateImageLike({ name: "button.webp", type: "image/webp", size: 1024 }).extension).toBe("webp");
  });

  it("rejects SVG and oversized images", () => {
    expect(() => validateImageLike({ name: "unsafe.svg", type: "image/svg+xml", size: 1024 })).toThrow(/SVG/);
    expect(() => validateImageLike({ name: "huge.png", type: "image/png", size: MAX_IMAGE_BYTES + 1 })).toThrow(
      /20MB/
    );
  });
});
