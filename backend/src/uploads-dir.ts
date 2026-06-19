import { fileURLToPath } from "node:url";
import path from "node:path";

// Absolute upload directory, resolved from the SERVER package root so the path is
// identical in dev (tsx src/) and prod (node dist/). import.meta.url is
// .../src/uploads-dir.ts (dev) or .../dist/uploads-dir.js (prod); go up one level
// from src/ or dist/ to the package root, then into uploads/.
const here = path.dirname(fileURLToPath(import.meta.url)); // src OR dist
export const UPLOAD_DIR = path.resolve(here, "..", "uploads"); // <serverRoot>/uploads
