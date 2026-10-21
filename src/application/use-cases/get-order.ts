import type { Order } from "../../domain/order.js";
import type { OrderRepository } from "../ports/order-repository.js";

export class OrderNotFoundError extends Error {
  constructor(orderId: string) {
    super(`Order ${orderId} was not found`);
    this.name = "OrderNotFoundError";
  }
}

export class GetOrder {
  constructor(private readonly orders: OrderRepository) {}

  async execute(orderId: string): Promise<Order> {
    const order = await this.orders.findById(orderId);
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }
    return order;
  }
}
