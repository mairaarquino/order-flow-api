import { randomUUID } from "node:crypto";
import type { PaymentGateway, PaymentRequest, PaymentResult } from "../../application/ports/payment-gateway.js";

export class SimulatedPaymentGateway implements PaymentGateway {
  async processPayment(_request: PaymentRequest): Promise<PaymentResult> {
    return {
      approved: true,
      transactionId: `sim-${randomUUID()}`,
    };
  }
}
