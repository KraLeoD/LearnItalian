export class AppError extends Error {
  constructor(
    public readonly code: 'QUOTA_EXCEEDED' | 'PROVIDER_FAILED' | 'NOT_FOUND' | 'CONFLICT' | 'INVALID_REQUEST',
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}

export function publicError(error: unknown) {
  if (error instanceof AppError) return { statusCode: error.statusCode, body: { error: error.code, message: error.message } };
  return { statusCode: 500, body: { error: 'INTERNAL_ERROR', message: 'Etwas ist schiefgegangen. Bitte versuche es erneut.' } };
}
