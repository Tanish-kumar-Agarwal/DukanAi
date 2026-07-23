import axios from 'axios';

import { clientConfig } from '../config/env';

/**
 * Turns any thrown API error into a specific, user-facing message that names
 * the operation that failed and, when relevant, the unreachable API URL.
 * Always logs the underlying error so root causes are never swallowed.
 */
export function describeApiError(error: unknown, operation: string): string {
  console.error(`[api] ${operation} failed:`, error);

  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return `${operation} failed: the API at ${clientConfig.NEXT_PUBLIC_API_URL} is unreachable. Is the backend running?`;
    }
    const data = error.response.data as { message?: string | string[] } | undefined;
    const serverMessage = Array.isArray(data?.message) ? data?.message.join(', ') : data?.message;
    return `${operation} failed (HTTP ${error.response.status}${serverMessage ? `: ${serverMessage}` : ''}).`;
  }

  if (error instanceof Error && error.message) {
    return `${operation} failed: ${error.message}`;
  }
  return `${operation} failed due to an unexpected error.`;
}
