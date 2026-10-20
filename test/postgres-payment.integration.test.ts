import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { Pool } from "pg";
import { OrderAlreadyPaidError, PayOrder } from "../src/application/use-cases/pay-order.js";
import type { PaymentGateway } from "../src/application/ports/payment-gateway.js";
import { Order } from "../src/domain/order.js";
import { PostgresOrderRepository } from "../src/infrastructure/persistence/postgres-order-repository.js";

const connectionString = process.env.ORDERFLOW_TEST_DATABASE_URL;
const pool = connectionString ? new Pool({ connectionString }) : undefined;
const repository = pool ? new PostgresOrderRepository(pool) : undefined;

after(async () => {
  await pool?.end();
});

async function withOrder(run: (order: Order) => Promise<void>): Promise<void> {
  if (!pool || !repository) {
    throw new Error("PostgreSQL test database is not configured");
  }
  const order = Order.create(
    randomUUID(),
    [{ productId: "integration-product", quantity: 1, unitPriceCents: 499 }],
    new Date(),
  );
  await repository.save(order);
  try {
    await run(order);
  } finally {
    await pool.query("DELETE FROM payment_idempotency WHERE order_id = $1", [order.id]);
    await pool.query("DELETE FROM orders WHERE id = $1", [order.id]);
  }
}

test("PostgreSQL serializes duplicate payment requests and replays the result", {
  skip: !connectionString,
}, async () => {
  await withOrder(async (order) => {
    let gatewayCalls = 0;
    const gateway: PaymentGateway = {
      processPayment: async () => {
        gatewayCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { approved: true, transactionId: "integration-transaction" };
      },
    };
    const payOrder = new PayOrder(repository!, gateway);

    const results = await Promise.all([
      payOrder.execute(order.id, "duplicate-payment-key"),
      payOrder.execute(order.id, "duplicate-payment-key"),
    ]);

    assert.equal(gatewayCalls, 1);
    assert.deepEqual(results[0], results[1]);
    assert.equal((await repository!.findById(order.id))?.status, "paid");
    const replay = await payOrder.execute(order.id, "duplicate-payment-key");
    assert.deepEqual(replay, results[0]);
    assert.equal(gatewayCalls, 1);
  });
});

test("PostgreSQL prevents concurrent charges using different keys", {
  skip: !connectionString,
}, async () => {
  await withOrder(async (order) => {
    let gatewayCalls = 0;
    const gateway: PaymentGateway = {
      processPayment: async () => {
        gatewayCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { approved: true, transactionId: "single-charge" };
      },
    };
    const payOrder = new PayOrder(repository!, gateway);
    const results = await Promise.allSettled([
      payOrder.execute(order.id, "concurrent-key-one"),
      payOrder.execute(order.id, "concurrent-key-two"),
    ]);

    assert.equal(gatewayCalls, 1);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejection = results.find((result) => result.status === "rejected");
    assert.equal(rejection?.status, "rejected");
    if (rejection?.status === "rejected") {
      assert.ok(rejection.reason instanceof OrderAlreadyPaidError);
    }
  });
});

test("PostgreSQL rolls back idempotency when the gateway fails", {
  skip: !connectionString,
}, async () => {
  await withOrder(async (order) => {
    let gatewayCalls = 0;
    const gateway: PaymentGateway = {
      processPayment: async () => {
        gatewayCalls += 1;
        if (gatewayCalls === 1) {
          throw new Error("Gateway unavailable");
        }
        return { approved: true, transactionId: "retry-transaction" };
      },
    };
    const payOrder = new PayOrder(repository!, gateway);
    const key = "gateway-failure-key";

    await assert.rejects(payOrder.execute(order.id, key), /Gateway unavailable/);
    const failedRecord = await pool!.query(
      "SELECT 1 FROM payment_idempotency WHERE idempotency_key = $1",
      [key],
    );
    assert.equal(failedRecord.rowCount, 0);

    const retry = await payOrder.execute(order.id, key);
    assert.equal(retry.payment.transactionId, "retry-transaction");
    assert.equal((await repository!.findById(order.id))?.status, "paid");
  });
});

test("PostgreSQL rejects an idempotency key reused for another order", {
  skip: !connectionString,
}, async () => {
  if (!pool || !repository) {
    throw new Error("PostgreSQL test database is not configured");
  }
  const firstOrder = Order.create(
    randomUUID(),
    [{ productId: "first-product", quantity: 1, unitPriceCents: 100 }],
    new Date(),
  );
  const secondOrder = Order.create(
    randomUUID(),
    [{ productId: "second-product", quantity: 1, unitPriceCents: 200 }],
    new Date(),
  );
  await repository.save(firstOrder);
  await repository.save(secondOrder);
  try {
    let gatewayCalls = 0;
    const payOrder = new PayOrder(repository, {
      processPayment: async () => {
        gatewayCalls += 1;
        return { approved: false, transactionId: "reused-key-transaction" };
      },
    });

    await payOrder.execute(firstOrder.id, "shared-postgres-key");
    await assert.rejects(
      payOrder.execute(secondOrder.id, "shared-postgres-key"),
      /different order/,
    );
    assert.equal(gatewayCalls, 1);
  } finally {
    await pool.query(
      "DELETE FROM payment_idempotency WHERE order_id = ANY($1::text[])",
      [[firstOrder.id, secondOrder.id]],
    );
    await pool.query("DELETE FROM orders WHERE id = ANY($1::text[])", [[firstOrder.id, secondOrder.id]]);
  }
});

test("PostgreSQL recovers a provider authorization after the response is lost", {
  skip: !connectionString,
}, async () => {
  await withOrder(async (order) => {
    const providerResults = new Map<string, { approved: boolean; transactionId: string }>();
    let authorizations = 0;
    let requests = 0;
    const gateway: PaymentGateway = {
      processPayment: async ({ idempotencyKey }) => {
        requests += 1;
        const existing = providerResults.get(idempotencyKey);
        if (existing) {
          return existing;
        }
        authorizations += 1;
        const result = { approved: true, transactionId: "provider-recovered-transaction" };
        providerResults.set(idempotencyKey, result);
        throw new Error("Response lost after provider authorization");
      },
    };
    const payOrder = new PayOrder(repository!, gateway);
    const key = "lost-provider-response-key";

    await assert.rejects(
      payOrder.execute(order.id, key),
      /Response lost after provider authorization/,
    );
    const rolledBack = await pool!.query(
      "SELECT 1 FROM payment_idempotency WHERE idempotency_key = $1",
      [key],
    );
    assert.equal(rolledBack.rowCount, 0);

    const recovered = await payOrder.execute(order.id, key);
    assert.equal(requests, 2);
    assert.equal(authorizations, 1);
    assert.equal(recovered.payment.transactionId, "provider-recovered-transaction");
    assert.equal((await repository!.findById(order.id))?.status, "paid");
  });
});

test("PostgreSQL recovers a provider authorization after payment persistence fails", {
  skip: !connectionString,
}, async () => {
  if (!pool || !repository) {
    throw new Error("PostgreSQL test database is not configured");
  }
  await withOrder(async (order) => {
    const suffix = randomUUID().replaceAll("-", "");
    const functionName = `fail_payment_${suffix}`;
    const triggerName = `fail_payment_${suffix}`;
    let functionCreated = false;
    let triggerCreated = false;

    try {
      await pool.query(
        `CREATE FUNCTION ${functionName}() RETURNS trigger AS $function$
         BEGIN
           IF NEW.id = '${order.id}' AND NEW.status = 'paid' THEN
             RAISE EXCEPTION 'simulated payment persistence failure';
           END IF;
           RETURN NEW;
         END;
         $function$ LANGUAGE plpgsql`,
      );
      functionCreated = true;
      await pool.query(
        `CREATE TRIGGER ${triggerName}
         BEFORE UPDATE ON orders
         FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
      );
      triggerCreated = true;

      const providerResults = new Map<string, { approved: boolean; transactionId: string }>();
      let authorizations = 0;
      let requests = 0;
      const gateway: PaymentGateway = {
        processPayment: async ({ idempotencyKey }) => {
          requests += 1;
          const existing = providerResults.get(idempotencyKey);
          if (existing) {
            return existing;
          }
          authorizations += 1;
          const result = { approved: true, transactionId: "provider-persistence-retry" };
          providerResults.set(idempotencyKey, result);
          return result;
        },
      };
      const payOrder = new PayOrder(repository, gateway);
      const key = `persistence-failure-${order.id}`;

      await assert.rejects(
        payOrder.execute(order.id, key),
        /simulated payment persistence failure/,
      );
      assert.equal((await repository.findById(order.id))?.status, "pending_payment");
      const rolledBack = await pool.query(
        "SELECT 1 FROM payment_idempotency WHERE idempotency_key = $1",
        [key],
      );
      assert.equal(rolledBack.rowCount, 0);

      await pool.query(`DROP TRIGGER ${triggerName} ON orders`);
      triggerCreated = false;
      const recovered = await payOrder.execute(order.id, key);

      assert.equal(requests, 2);
      assert.equal(authorizations, 1);
      assert.equal(recovered.payment.transactionId, "provider-persistence-retry");
      assert.equal((await repository.findById(order.id))?.status, "paid");
    } finally {
      if (triggerCreated) {
        await pool.query(`DROP TRIGGER ${triggerName} ON orders`);
      }
      if (functionCreated) {
        await pool.query(`DROP FUNCTION ${functionName}()`);
      }
    }
  });
});
