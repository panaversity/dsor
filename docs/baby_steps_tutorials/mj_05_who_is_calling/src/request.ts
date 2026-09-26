// NEW IN STEP 05: the request envelope travels beside a call's arguments, never inside
// them. It carries the login token that says who is calling, and an optional request id
// that labels the call. DSOR-SRC-02a in specs/dsor/02-security.md, section 11.

/**
 * What travels beside the arguments: who is calling, and which call this is. It comes
 * from outside the program, so its fields have no types yet.
 */
export type RequestEnvelope = { token?: unknown; request_id?: unknown };
