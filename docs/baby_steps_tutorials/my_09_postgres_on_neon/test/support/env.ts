// Load `.env`, if there is one, before any test reads `process.env`.
//
// NEW IN STEP 09, and it closes a real hole: `.env.example` existed, the README told a learner to copy
// it and fill it in, and **nothing in the step read the file**. The database tier would have reported
// `4 skipped` to somebody who had set everything up correctly, and said nothing about why.
//
// `process.loadEnvFile` is Node's own, so there is no dependency. It throws when the file is absent,
// which is the normal case — the step is meant to run with no database — so that is caught and
// ignored rather than treated as a problem.

try {
  process.loadEnvFile(".env");
} catch {
  // No `.env`. The tests that need one skip themselves, and say so in the report.
}
