import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // apps/server/src

/**
 * On-device data directory (gitignored). Holds the encrypted key store and the
 * machine-local secret. Override with LATTEART_DATA_DIR.
 */
export const DATA_DIR = process.env.LATTEART_DATA_DIR ?? join(here, "..", ".data");
