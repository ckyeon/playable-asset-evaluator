import { NextResponse } from "next/server";

export function ok<T>(body: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(body, init);
}

export function errorResponse(error: unknown, status = 400): NextResponse<{ error: string }> {
  const message = error instanceof Error ? error.message : "Unexpected error.";
  return NextResponse.json({ error: message }, { status });
}
