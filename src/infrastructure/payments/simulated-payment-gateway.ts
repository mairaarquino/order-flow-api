import { randomUUID } from "node:crypto";
import type { PaymentGateway, PaymentRequest, PaymentResult } from "../../application/ports/payment-gateway.js";

export class SimulatedPaymentGateway implements PaymentGateway {
  private readonly results = new Map<string, PaymentResult>();

  async processPayment(request: PaymentRequest): Promise<PaymentResult> {
    const existing = this.results.get(request.idempotencyKey);
    if (existing) {
      return existing;
    }
    const result = {
      approved: true,
      transactionId: `sim-${randomUUID()}`,
    };
    this.results.set(request.idempotencyKey, result);
    return result;
  }
}
