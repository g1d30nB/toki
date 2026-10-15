// Writes firmware/toki/face_data.h from the simulator's face definition.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { exportFaceHeader } from "../src/face/exportFace";

const out = fileURLToPath(new URL("../../firmware/toki/face_data.h", import.meta.url));
writeFileSync(out, exportFaceHeader());
console.log(`Wrote ${out}`);
