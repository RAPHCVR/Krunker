import { z } from 'zod';
import type { ClientInput, JoinMatchOptions, ShootMessage } from '@krunker-arena/shared';

const finiteNumber = z.number().finite();
const sequenceNumber = z.number().int().safe().min(0);

const joinMatchOptionsSchema = z
  .object({
    displayName: z.string().min(1).max(64),
  })
  .strict();

const clientInputSchema = z
  .object({
    seq: sequenceNumber,
    spawnSeq: sequenceNumber.optional(),
    forward: finiteNumber,
    right: finiteNumber,
    jump: z.boolean(),
    sprint: z.boolean(),
    yaw: finiteNumber,
    pitch: finiteNumber,
  })
  .strict();

const shootMessageSchema = z
  .object({
    seq: sequenceNumber,
    spawnSeq: sequenceNumber.optional(),
    yaw: finiteNumber,
    pitch: finiteNumber,
  })
  .strict();

export function parseJoinMatchOptions(payload: unknown): JoinMatchOptions {
  const parsed = joinMatchOptionsSchema.safeParse(payload);
  return parsed.success ? parsed.data : { displayName: 'Guest' };
}

export function parseClientInput(payload: unknown): ClientInput | null {
  const parsed = clientInputSchema.safeParse(payload);
  if (!parsed.success) return null;
  const { spawnSeq, ...input } = parsed.data;
  return spawnSeq === undefined ? input : { ...input, spawnSeq };
}

export function parseShootMessage(payload: unknown): ShootMessage | null {
  const parsed = shootMessageSchema.safeParse(payload);
  if (!parsed.success) return null;
  const { spawnSeq, ...message } = parsed.data;
  return spawnSeq === undefined ? message : { ...message, spawnSeq };
}
