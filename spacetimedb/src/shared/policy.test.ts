import { describe, expect, it } from 'vitest';
import {
  canRead,
  canWrite,
  CHANNELS,
  INVITABLE_ROLES,
  isChannel,
  isInvitableRole,
  isRole,
  readableChannels,
  ROLES,
} from './policy';

describe('policy matrix', () => {
  it('technical cannot read #privileged, executive cannot read #technical', () => {
    expect(canRead('technical', 'privileged')).toBe(false);
    expect(canRead('executive', 'technical')).toBe(false);
    expect(canRead('counsel', 'privileged')).toBe(true);
  });
  it('executive cannot write #record', () => {
    expect(canWrite('executive', 'record')).toBe(false);
    expect(canWrite('executive', 'command')).toBe(true);
  });
  it('anyone who can write a channel can read it', () => {
    for (const r of ROLES) for (const c of CHANNELS) if (canWrite(r, c)) expect(canRead(r, c)).toBe(true);
  });
  it('commander is never invitable', () => {
    expect(INVITABLE_ROLES).not.toContain('commander');
    expect(isInvitableRole('commander')).toBe(false);
    expect(isInvitableRole('counsel')).toBe(true);
  });
  it('type guards reject unknown values', () => {
    expect(isRole('admin')).toBe(false);
    expect(isRole(1)).toBe(false);
    expect(isChannel('debug')).toBe(false);
    expect(isChannel('record')).toBe(true);
  });
  it('readableChannels follows the matrix', () => {
    expect(readableChannels('technical')).toEqual(['record', 'command', 'technical']);
    expect(readableChannels('executive')).toEqual(['record', 'command', 'privileged']);
    expect(readableChannels('commander')).toEqual([...CHANNELS]);
  });
});
