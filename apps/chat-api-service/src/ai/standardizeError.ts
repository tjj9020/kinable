import { AIModelError } from '../../../../packages/common-types/src/ai-interfaces';
import OpenAI from 'openai'; // Assuming this is needed for type checks like OpenAI.APIError

/**
 * Standardizes an error from an AI provider into the common AIModelError format.
 * @param error The error object from the provider.
 * @param providerName The name of the provider that threw the error.
 * @returns An AIModelError object.
 */
export function standardizeError(error: any, providerName: string): AIModelError {
  // Default error structure
  let standardized: AIModelError = {
    ok: false,
    code: 'UNKNOWN',
    provider: providerName,
    retryable: true, // Default to retryable for unknown errors
    detail: error.message || 'An unknown error occurred',
    status: error.status, // Capture HTTP status if available
  };

  if (error instanceof OpenAI.APIError) { // OpenAI specific errors
    standardized.status = error.status;
    standardized.detail = error.message;

    if (error instanceof OpenAI.RateLimitError) { // HTTP 429
      standardized.code = 'RATE_LIMIT';
      standardized.retryable = true;
    } else if (error instanceof OpenAI.AuthenticationError) { // HTTP 401
      standardized.code = 'AUTH';
      standardized.retryable = false;
    } else if (error instanceof OpenAI.PermissionDeniedError) { // HTTP 403
      standardized.code = 'AUTH'; // Or a more specific PERMISSION_DENIED
      standardized.retryable = false;
    } else if (error instanceof OpenAI.NotFoundError) { // HTTP 404 (e.g. model not found)
      standardized.code = 'CAPABILITY'; // Model/resource not found maps to capability issue
      standardized.retryable = false;
    } else if (error instanceof OpenAI.ConflictError || error instanceof OpenAI.UnprocessableEntityError) { // HTTP 409, 422 (e.g. invalid request)
      standardized.code = 'CONTENT'; // Often due to content or request structure
      standardized.retryable = false;
    } else if (error instanceof OpenAI.InternalServerError || error instanceof OpenAI.APIConnectionError) { // HTTP 500, 503 or network issues
      standardized.code = 'TIMEOUT'; // Or a more generic 'PROVIDER_ISSUE'
      standardized.retryable = true;
    } else if (error.message && error.message.includes('moderation')) {
        standardized.code = 'CONTENT';
        standardized.retryable = false;
    }
    // Add more specific OpenAI error type checks if needed
  } else if (error.response && error.response.data && error.response.data.type === 'error') { // Anthropic specific errors
    const anthropicError = error.response.data.error;
    standardized.detail = anthropicError.message || 'Anthropic API error';
    standardized.status = error.response.status;

    switch (anthropicError.type) {
      case 'authentication_error':
        standardized.code = 'AUTH';
        standardized.retryable = false;
        break;
      case 'permission_error':
        standardized.code = 'AUTH'; // Or a more specific PERMISSION_DENIED
        standardized.retryable = false;
        break;
      case 'not_found_error':
        standardized.code = 'CAPABILITY'; // Resource not found
        standardized.retryable = false;
        break;
      case 'rate_limit_error':
        standardized.code = 'RATE_LIMIT';
        standardized.retryable = true;
        break;
      case 'api_error': // General server-side error at Anthropic
      case 'overloaded_error':
        standardized.code = 'TIMEOUT'; // Or PROVIDER_ISSUE
        standardized.retryable = true;
        break;
      case 'invalid_request_error':
      default:
        standardized.code = 'CONTENT'; // Often due to input validation
        standardized.retryable = false; // Usually not retryable without change
        break;
    }
  } else if (error.code === 'ECONNABORTED' || (error.message && error.message.toLowerCase().includes('timeout'))) {
    standardized.code = 'TIMEOUT';
    standardized.retryable = true;
    standardized.detail = error.message || 'Request timed out';
  }
  // Add more generic error type checks (e.g., network errors) if needed

  return standardized;
} 