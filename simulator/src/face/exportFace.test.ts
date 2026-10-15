import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exportFaceHeader } from "./exportFace";

describe("firmware face header", () => {
  it("is up to date with the simulator (run npm run export-face)", () => {
    const committed = readFileSync(new URL("../../../firmware/toki/face_data.h", import.meta.url), "utf8");
    expect(committed).toBe(exportFaceHeader());
  });
});
