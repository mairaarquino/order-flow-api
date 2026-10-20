import type { Order } from "../../domain/order.js";
import type { PaymentGateway } from "../ports/payment-gateway.js";
import type { OrderPaymentResult, PaymentRepository } from "../ports/payment-repository.js";

export class OrderNotFoundError extends Error {
  constructor(orderId: string) {
    super(`Order ${orderId} was not found`);
    this.name = "OrderNotFoundError";
  }
}

export class OrderAlreadyPaidError extends Error {
  constructor(orderId: string) {
    super(`Order ${orderId} has already been paid`);
    this.name = "OrderAlreadyPaidError";
  }
}

export class InvalidIdempotencyKeyError extends Error {
  constructor() {
    super("Idempotency-Key must contain between 1 and 200 characters");
    this.name = "InvalidIdempotencyKeyError";
  }
}

export interface PayOrderResult {
  readonly order: Order;
  readonly payment: {
    readonly status: "approved" | "declined";
    readonly transactionId: string;
  };
}

export class PayOrder {
  constructor(
    private readonly orders: PaymentRepository,
    private readonly paymentGateway: PaymentGateway,
  ) {}

  async execute(orderId: string, idempotencyKey: string): Promise<PayOrderResult> {
    const normalizedKey = idempotencyKey.trim();
    if (normalizedKey.length === 0 || normalizedKey.length > 200) {
      throw new InvalidIdempotencyKeyError();
    }
    return this.orders.executeIdempotently(orderId, normalizedKey, async (order): Promise<OrderPaymentResult> => {
      if (!order) {
        throw new OrderNotFoundError(orderId);
      }
      if (order.status === "paid") {
        throw new OrderAlreadyPaidError(order.id);
      }

      const payment = await this.paymentGateway.processPayment({
        orderId: order.id,
        amountCents: order.totalCents,
        idempotencyKey: `${order.id}:${normalizedKey}`,
      });

      if (payment.approved) {
        order.markAsPaid();
      }
      return { order, payment };
    });
  }
}
