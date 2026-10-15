export class WorkflowError extends Error {
  constructor(
    message: string,
    readonly code: 'forbidden' | 'invalid-state' | 'stale-hash' | 'missing-note' | 'not-found' | 'lanes-pending',
  ) {
    super(message);
  }
}
