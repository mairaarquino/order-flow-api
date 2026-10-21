import { CreateOrder } from "../../application/use-cases/create-order.js";
import { GetOrder } from "../../application/use-cases/get-order.js";
import { PayOrder } from "../../application/use-cases/pay-order.js";
import { OrderValidationError, type OrderItem } from "../../domain/order.js";

export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRequestError";
  }
}

export interface OrderResponse {
  readonly id: string;
  readonly items: readonly OrderItem[];
  readonly totalCents: number;
  readonly createdAt: string;
  readonly status: "pending_payment" | "paid";
}

export interface PaymentResponse {
  readonly order: OrderResponse;
  readonly payment: {
    readonly status: "approved" | "declined";
    readonly transactionId: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseItems(body: unknown): readonly OrderItem[] {
  if (!isRecord(body) || !Array.isArray(body.items)) {
    throw new InvalidRequestError("Request body must contain an items array");
  }

  return body.items.map((item): OrderItem => {
    if (
      !isRecord(item) ||
      typeof item.productId !== "string" ||
      typeof item.quantity !== "number" ||
      typeof item.unitPriceCents !== "number"
    ) {
      throw new InvalidRequestError("Each item must include productId, quantity, and unitPriceCents");
    }

    return {
      productId: item.productId,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
    };
  });
}

export class OrderController {
  constructor(
    private readonly createOrder: CreateOrder,
    private readonly payOrder: PayOrder,
    private readonly getOrder: GetOrder,
  ) {}

  async create(body: unknown): Promise<OrderResponse> {
    try {
      const order = await this.createOrder.execute({ items: parseItems(body) });
      return {
        id: order.id,
        items: order.items,
        totalCents: order.totalCents,
        createdAt: order.createdAt.toISOString(),
        status: order.status,
      };
    } catch (error) {
      if (error instanceof OrderValidationError) {
        throw new InvalidRequestError(error.message);
      }
      throw error;
    }
  }

  async pay(orderId: string, idempotencyKey: string): Promise<PaymentResponse> {
    const result = await this.payOrder.execute(orderId, idempotencyKey);
    return {
      order: {
        id: result.order.id,
        items: result.order.items,
        totalCents: result.order.totalCents,
        createdAt: result.order.createdAt.toISOString(),
        status: result.order.status,
      },
      payment: result.payment,
    };
  }

  async getById(orderId: string): Promise<OrderResponse> {
    const order = await this.getOrder.execute(orderId);
    return {
      id: order.id,
      items: order.items,
      totalCents: order.totalCents,
      createdAt: order.createdAt.toISOString(),
      status: order.status,
    };
  }
}
