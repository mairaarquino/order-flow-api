import type { Order } from "../../domain/order.js";
import type { PaymentResult } from "./payment-gateway.js";
import type { OrderRepository } from "./order-repository.js";

export interface OrderPaymentResult {
  readonly order: Order;
  readonly payment: PaymentResult;
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key has already been used for a different order");
    this.name = "IdempotencyConflictError";
  }
}

export interface PaymentRepository extends OrderRepository {
  executeIdempotently(
    orderId: string,
    idempotencyKey: string,
    operation: (order: Order | null) => Promise<OrderPaymentResult>,
  ): Promise<OrderPaymentResult>;
}
