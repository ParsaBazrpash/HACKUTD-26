// Roles, channels and the read/write matrix (docs/PLAN.md 4.1).
// Shared by the Spacetime module and the browser client. Imports nothing.

export const ROLES = ['commander', 'counsel', 'technical', 'executive'] as const;
export type Role = (typeof ROLES)[number];
export const CHANNELS = ['record', 'command', 'privileged', 'technical'] as const;
export type ChannelKind = (typeof CHANNELS)[number];

/** Who can decrypt (and receive rows of) each channel. */
export const READ: Record<ChannelKind, readonly Role[]> = {
  record: ['commander', 'counsel', 'technical', 'executive'],
  command: ['commander', 'counsel', 'technical', 'executive'],
  privileged: ['commander', 'counsel', 'executive'],
  technical: ['commander', 'counsel', 'technical'],
};

/** Who can append to each channel. */
export const WRITE: Record<ChannelKind, readonly Role[]> = {
  record: ['commander', 'counsel', 'technical'],
  command: ['commander', 'counsel', 'technical', 'executive'],
  privileged: ['commander', 'counsel', 'executive'],
  technical: ['commander', 'counsel', 'technical'],
};

export const INVITABLE_ROLES: readonly Role[] = ['counsel', 'technical', 'executive'];

export type MemberStateName = 'pending' | 'active' | 'revoked';
export const MEMBER_STATES: readonly MemberStateName[] = ['pending', 'active', 'revoked'];

export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v);
export const isChannel = (v: unknown): v is ChannelKind =>
  typeof v === 'string' && (CHANNELS as readonly string[]).includes(v);
export const isInvitableRole = (v: unknown): v is Role =>
  typeof v === 'string' && (INVITABLE_ROLES as readonly string[]).includes(v);

export const canRead = (r: Role, c: ChannelKind): boolean => READ[c].includes(r);
export const canWrite = (r: Role, c: ChannelKind): boolean => WRITE[c].includes(r);

/** Channels a role can decrypt, in canonical CHANNELS order. */
export const readableChannels = (r: Role): ChannelKind[] => CHANNELS.filter((c) => canRead(r, c));
