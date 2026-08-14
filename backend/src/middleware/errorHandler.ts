import type { Request, Response, NextFunction } from "express";

interface ErrorBody {
  error: {
    message: string;
    details?: unknown;
  };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: { message: `Not found: ${req.method} ${req.path}` } } satisfies ErrorBody);
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: { message: err.message, ...(err.details ? { details: err.details } : {}) },
    } satisfies ErrorBody);
    return;
  }
  if (err instanceof SyntaxError) {
    res.status(400).json({ error: { message: "Invalid JSON body" } } satisfies ErrorBody);
    return;
  }
  // Prisma known errors
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (code === "P2025") {
      res.status(404).json({ error: { message: "Record not found" } } satisfies ErrorBody);
      return;
    }
  }
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: { message: "Internal server error" } } satisfies ErrorBody);
}