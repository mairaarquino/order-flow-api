import type { Order } from "../../domain/order.js";
import type { OrderRepository } from "../ports/order-repository.js";
import type { PaymentGateway } from "../ports/payment-gateway.js";

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

export interface PayOrderResult {
  readonly order: Order;
  readonly payment: {
    readonly status: "approved" | "declined";
    readonly transactionId: string;
  };
}

export class PayOrder {
  constructor(
    private readonly orders: OrderRepository,
    private readonly paymentGateway: PaymentGateway,
  ) {}

  async execute(orderId: string): Promise<PayOrderResult> {
    const order = await this.orders.findById(orderId);
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }
    if (order.status === "paid") {
      throw new OrderAlreadyPaidError(order.id);
    }

    const payment = await this.paymentGateway.processPayment({
      orderId: order.id,
      amountCents: order.totalCents,
    });

    if (payment.approved) {
      order.markAsPaid();
      await this.orders.save(order);
    }

    return {
      order,
      payment: {
        status: payment.approved ? "approved" : "declined",
        transactionId: payment.transactionId,
      },
    };
  }
}
