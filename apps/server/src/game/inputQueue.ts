import { GAMEPLAY, simulateMovement, type ClientInput, type MovementState } from '@krunker-arena/shared';

export type QueuedInputResult = {
  movement: MovementState;
  latestInput: ClientInput;
  inputSeq: number;
  appliedCommands: number;
};

export function applyQueuedHumanInputs(
  movement: MovementState,
  inputQueue: ClientInput[],
  latestInput: ClientInput,
  inputSeq: number,
  maxCommands = GAMEPLAY.maxInputCommandsPerTick,
): QueuedInputResult {
  let nextMovement = movement;
  let nextLatestInput = latestInput;
  let nextInputSeq = inputSeq;
  let appliedCommands = 0;

  while (inputQueue.length > 0 && appliedCommands < maxCommands) {
    const input = inputQueue.shift()!;
    nextLatestInput = input;
    nextMovement = simulateMovement(nextMovement, input).state;
    nextInputSeq = input.seq;
    appliedCommands += 1;
  }

  return {
    movement: nextMovement,
    latestInput: nextLatestInput,
    inputSeq: nextInputSeq,
    appliedCommands,
  };
}
