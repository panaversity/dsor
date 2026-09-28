// NEW IN STEP 09: runs before each database test file. With no DSOR_DB_URL, it throws, so
// every database test fails and none is skipped (step 09's README, decision 8).
import { loadDotEnv, requireEnv } from "../src/postgres.ts";

loadDotEnv(["DSOR_DB_URL"]);
requireEnv("DSOR_DB_URL");
