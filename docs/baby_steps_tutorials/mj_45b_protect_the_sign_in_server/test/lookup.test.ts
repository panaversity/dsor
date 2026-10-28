// The lookup joins the list every role source passes (step 45's README, D5). DSoR
// asks a test sign-in server for org_456, at the address that lookups.json would name, with the
// company's test key (D11, D14). The list's switches become the server's: "cannot answer now" is
// a 503, and "read at 01:01" is that time of the story's night.
import { lookupDirectory } from "../src/lookup.ts";
import { NIGHT, roleSourceList } from "./role-source-list.ts";
import { startSignInServer } from "./sign-in-server.ts";

roleSourceList({
  name: "the lookup, against a test sign-in server",
  start: async () => {
    const server = await startSignInServer("org_456", {
      user_123: { status: "active", roles: ["ap_supervisor"] },
      cfo_100: { status: "active", roles: ["CFO"] },
    });
    const lookup = lookupDirectory({ tenant: "org_456", address: server.address, key: server.key });
    return {
      directories: new Map([["org_456", lookup]]),
      switches: {
        set: server.set,
        answerAbout: server.answerAbout,
        replyUnreadable: server.replyUnreadable,
        readAt: (time) => server.readAt(`${NIGHT}T${time}:00Z`),
        stopAnswering: () => server.replyStatus(503),
      },
      stop: server.stop,
    };
  },
});
