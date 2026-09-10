export function canAcceptRunEvent(
  currentExecutionId: string | undefined,
  incomingExecutionId: string,
): boolean {
  return currentExecutionId === undefined || currentExecutionId === incomingExecutionId;
}
