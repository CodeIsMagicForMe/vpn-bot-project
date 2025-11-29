// src/utils/errors.ts

export class AppError extends Error {
  public readonly code: string;
  public readonly status?: number;
  public readonly details?: unknown;

  constructor(message: string, options?: { code?: string; status?: number; details?: unknown }) {
    super(message);
    this.name = "AppError";
    this.code = options?.code || "INTERNAL_ERROR";
    this.status = options?.status;
    this.details = options?.details;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { code: "BAD_REQUEST", status: 400, details });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, { code: "FORBIDDEN", status: 403 });
  }
}

