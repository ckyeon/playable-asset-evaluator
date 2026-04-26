export class EvaluationAdapterError extends Error {
  constructor(
    message: string,
    readonly rawOutput: unknown
  ) {
    super(message);
    this.name = "EvaluationAdapterError";
  }
}
