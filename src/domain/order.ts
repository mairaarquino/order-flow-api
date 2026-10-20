export interface OrderItem {
  readonly productId: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
}

export type OrderStatus = "pending_payment" | "paid";

export class OrderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderValidationError";
  }
}

export class Order {
  private currentStatus: OrderStatus = "pending_payment";

  private constructor(
    readonly id: string,
    readonly items: readonly OrderItem[],
    readonly totalCents: number,
    readonly createdAt: Date,
  ) {}

  get status(): OrderStatus {
    return this.currentStatus;
  }

  static create(id: string, items: readonly OrderItem[], createdAt: Date): Order {
    if (!id.trim()) {
      throw new OrderValidationError("Order id is required");
    }
    if (items.length === 0) {
      throw new OrderValidationError("An order must contain at least one item");
    }
    if (Number.isNaN(createdAt.getTime())) {
      throw new OrderValidationError("Order creation date is invalid");
    }

    let totalCents = 0;
    const validatedItems = items.map((item) => {
      if (!item.productId.trim()) {
        throw new OrderValidationError("Product id is required");
      }
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
        throw new OrderValidationError("Item quantity must be a positive integer");
      }
      if (!Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents < 0) {
        throw new OrderValidationError("Unit price must be a non-negative integer in cents");
      }

      const lineTotal = item.quantity * item.unitPriceCents;
      if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(totalCents + lineTotal)) {
        throw new OrderValidationError("Order total exceeds the supported amount");
      }
      totalCents += lineTotal;
      return Object.freeze({ ...item });
    });

    return new Order(id, Object.freeze(validatedItems), totalCents, new Date(createdAt));
  }

  markAsPaid(): void {
    if (this.currentStatus !== "pending_payment") {
      throw new OrderValidationError("Only orders pending payment can be marked as paid");
    }
    this.currentStatus = "paid";
  }
}
