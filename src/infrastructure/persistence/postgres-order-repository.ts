import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type { OrderItem, OrderStatus } from "../../domain/order.js";
import { Order } from "../../domain/order.js";
import type { OrderPaymentResult, PaymentRepository } from "../../application/ports/payment-repository.js";
import { IdempotencyConflictError } from "../../application/ports/payment-repository.js";

interface OrderRow extends QueryResultRow {
  id: string;
  items: unknown;
  total_cents: string;
  status: string;
  created_at: Date;
}

interface IdempotencyRow extends QueryResultRow {
  order_id: string;
  response: unknown;
}

function orderFromRow(row: OrderRow): Order {
  const totalCents = Number(row.total_cents);
  if (!Number.isSafeInteger(totalCents) || !Array.isArray(row.items)) {
    throw new Error(`Persisted order ${row.id} contains invalid data`);
  }
  return Order.restore(
    row.id,
    row.items as OrderItem[],
    totalCents,
    row.created_at,
    row.status as OrderStatus,
  );
}

function orderToJson(order: Order): object {
  return {
    id: order.id,
    items: order.items,
    totalCents: order.totalCents,
    createdAt: order.createdAt.toISOString(),
    status: order.status,
  };
}

function resultFromJson(value: unknown): OrderPaymentResult {
  if (typeof value !== "object" || value === null) {
    throw new Error("Persisted idempotency response is invalid");
  }
  const data = value as Record<string, unknown>;
  const order = data.order as Record<string, unknown> | undefined;
  const payment = data.payment as Record<string, unknown> | undefined;
  if (
    !order ||
    !Array.isArray(order.items) ||
    typeof order.id !== "string" ||
    typeof order.totalCents !== "number" ||
    typeof order.createdAt !== "string" ||
    (order.status !== "pending_payment" && order.status !== "paid") ||
    !payment ||
    typeof payment.approved !== "boolean" ||
    typeof payment.transactionId !== "string"
  ) {
    throw new Error("Persisted idempotency response is invalid");
  }
  return {
    order: Order.restore(
      order.id,
      order.items as OrderItem[],
      order.totalCents,
      new Date(order.createdAt),
      order.status,
    ),
    payment: {
      approved: payment.approved,
      transactionId: payment.transactionId,
    },
  };
}

export class PostgresOrderRepository implements PaymentRepository {
  constructor(private readonly pool: Pool) {}

  async save(order: Order): Promise<void> {
    await this.pool.query(
      `INSERT INTO orders (id, items, total_cents, status, created_at)
       VALUES ($1, $2::jsonb, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         items = EXCLUDED.items,
         total_cents = EXCLUDED.total_cents,
         status = EXCLUDED.status`,
      [order.id, JSON.stringify(order.items), order.totalCents, order.status, order.createdAt],
    );
  }

  async findById(id: string): Promise<Order | null> {
    const result = await this.pool.query<OrderRow>(
      "SELECT id, items, total_cents, status, created_at FROM orders WHERE id = $1",
      [id],
    );
    return result.rows[0] ? orderFromRow(result.rows[0]) : null;
  }

  async executeIdempotently(
    orderId: string,
    idempotencyKey: string,
    operation: (order: Order | null) => Promise<OrderPaymentResult>,
  ): Promise<OrderPaymentResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO payment_idempotency (idempotency_key, order_id)
         VALUES ($1, $2)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [idempotencyKey, orderId],
      );
      const idempotency = await client.query<IdempotencyRow>(
        `SELECT order_id, response
         FROM payment_idempotency
         WHERE idempotency_key = $1
         FOR UPDATE`,
        [idempotencyKey],
      );
      const record = idempotency.rows[0];
      if (!record || record.order_id !== orderId) {
        throw new IdempotencyConflictError();
      }
      if (record.response !== null) {
        const replay = resultFromJson(record.response);
        await client.query("COMMIT");
        return replay;
      }

      const orderResult = await client.query<OrderRow>(
        `SELECT id, items, total_cents, status, created_at
         FROM orders
         WHERE id = $1
         FOR UPDATE`,
        [orderId],
      );
      const order = orderResult.rows[0] ? orderFromRow(orderResult.rows[0]) : null;
      const outcome = await operation(order);

      await this.saveInTransaction(client, outcome.order);
      await client.query(
        "UPDATE payment_idempotency SET response = $2::jsonb WHERE idempotency_key = $1",
        [
          idempotencyKey,
          JSON.stringify({
            order: orderToJson(outcome.order),
            payment: outcome.payment,
          }),
        ],
      );
      await client.query("COMMIT");
      return outcome;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async saveInTransaction(client: PoolClient, order: Order): Promise<void> {
    await client.query(
      `UPDATE orders SET status = $2 WHERE id = $1`,
      [order.id, order.status],
    );
  }
}
