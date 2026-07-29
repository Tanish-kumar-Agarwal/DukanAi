export class InvoiceMathError extends Error {
  public readonly code: string;

  constructor(message: string, code: string = 'ERR_MATH_VALIDATION') {
    super(message);
    this.name = 'InvoiceMathError';
    this.code = code;
    Object.setPrototypeOf(this, InvoiceMathError.prototype);
  }
}
