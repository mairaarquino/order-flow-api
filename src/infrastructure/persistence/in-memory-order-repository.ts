import type { Order } from "../../domain/order.js";
import {
  IdempotencyConflictError,
  type OrderPaymentResult,
  type PaymentRepository,
} from "../../application/ports/payment-repository.js";

export class InMemoryOrderRepository implements PaymentRepository {
  private readonly orders = new Map<string, Order>();
  private readonly paymentResults = new Map<string, { orderId: string; result: OrderPaymentResult }>();
  private paymentQueue: Promise<void> = Promise.resolve();

  async save(order: Order): Promise<void> {
    this.orders.set(order.id, order);
  }

  async findById(id: string): Promise<Order | null> {
    return this.orders.get(id) ?? null;
  }

  async executeIdempotently(
    orderId: string,
    idempotencyKey: string,
    operation: (order: Order | null) => Promise<OrderPaymentResult>,
  ): Promise<OrderPaymentResult> {
    let release!: () => void;
    const previous = this.paymentQueue;
    this.paymentQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const existing = this.paymentResults.get(idempotencyKey);
      if (existing) {
        if (existing.orderId !== orderId) {
          throw new IdempotencyConflictError();
        }
        return existing.result;
      }

      const order = await this.findById(orderId);
      const result = await operation(order);
      this.orders.set(result.order.id, result.order);
      this.paymentResults.set(idempotencyKey, { orderId, result });
      return result;
    } finally {
      release();
    }
  }
}
