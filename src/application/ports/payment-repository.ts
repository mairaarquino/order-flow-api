import type { Order } from "../../domain/order.js";
import type { OrderRepository } from "./order-repository.js";

export interface OrderPaymentResult {
  readonly order: Order;
  readonly payment: {
    readonly status: "approved" | "declined";
    readonly transactionId: string;
  };
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
