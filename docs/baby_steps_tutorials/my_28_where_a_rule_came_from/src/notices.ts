// NEW IN STEP 28: what DSoR tells a person, in an inbox each person has (decision 165).
//
// When a control's policy changes, its owner must hear about it: "the policy your control came from
// has a new version; review the control". A log is not where anybody learns their work, so DSoR also
// puts a notice in the owner's inbox. This one is a fake, kept in memory: a real one is a message,
// a ticket, or a task in the company's own tools. What DSoR says is the same.

/** One notice to one person. */
export interface Notice {
  readonly tenant: string;
  readonly to: string;
  readonly text: string;
}

const inboxes: Notice[] = [];

/** Tell a person something. */
export function tell(tenant: string, to: string, text: string): void {
  inboxes.push(Object.freeze({ tenant, to, text }));
}

/** What one person has been told in one company, oldest first. */
export function inboxOf(tenant: string, person: string): readonly Notice[] {
  return Object.freeze(inboxes.filter((n) => n.tenant === tenant && n.to === person));
}

/** Empty every inbox. Tests only. */
export function emptyTheInboxes(): void {
  inboxes.length = 0;
}
