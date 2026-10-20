import { Order, type OrderItem } from "../../domain/order.js";
import type { IdGenerator } from "../ports/id-generator.js";
import type { OrderRepository } from "../ports/order-repository.js";

export interface CreateOrderInput {
  readonly items: readonly OrderItem[];
}

export class CreateOrder {
  constructor(
    private readonly orders: OrderRepository,
    private readonly ids: IdGenerator,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: CreateOrderInput): Promise<Order> {
    const order = Order.create(this.ids.generate(), input.items, this.now());
    await this.orders.save(order);
    return order;
  }
}
