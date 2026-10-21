import assert from "node:assert/strict";
import test from "node:test";
import { Order } from "../src/domain/order.js";
import { OrderAlreadyPaidError, PayOrder } from "../src/application/use-cases/pay-order.js";
import { OrderNotFoundError } from "../src/application/use-cases/get-order.js";
import type { PaymentGateway } from "../src/application/ports/payment-gateway.js";
import { InMemoryOrderRepository } from "../src/infrastructure/persistence/in-memory-order-repository.js";

function makeOrder(): Order {
  return Order.create(
    "order-1",
    [{ productId: "product-1", quantity: 2, unitPriceCents: 1250 }],
    new Date("2026-10-20T12:00:00.000Z"),
  );
}

test("charges the persisted order total and marks an approved order as paid", async () => {
  const orders = new InMemoryOrderRepository();
  const order = makeOrder();
  await orders.save(order);

  let chargedOrderId = "";
  let chargedAmount = 0;
  const gateway: PaymentGateway = {
    processPayment: async ({ orderId, amountCents }) => {
      chargedOrderId = orderId;
      chargedAmount = amountCents;
      return { approved: true, transactionId: "sim-tx-1" };
    },
  };

  const result = await new PayOrder(orders, gateway).execute(order.id, "pay-order-1");

  assert.equal(chargedOrderId, "order-1");
  assert.equal(chargedAmount, 2500);
  assert.equal(result.payment.status, "approved");
  assert.equal(result.payment.transactionId, "sim-tx-1");
  assert.equal(result.order.status, "paid");
  assert.equal((await orders.findById(order.id))?.status, "paid");
});

test("replays declined payments and permits a retry with a new key", async () => {
  const orders = new InMemoryOrderRepository();
  const order = makeOrder();
  await orders.save(order);
  let gatewayCalls = 0;
  const gateway: PaymentGateway = {
    processPayment: async () => {
      gatewayCalls += 1;
      return gatewayCalls === 1
        ? { approved: false, transactionId: "sim-tx-declined" }
        : { approved: true, transactionId: "sim-tx-retry" };
    },
  };

  const payOrder = new PayOrder(orders, gateway);
  const result = await payOrder.execute(order.id, "pay-order-declined");
  const replay = await payOrder.execute(order.id, "pay-order-declined");

  assert.equal(result.payment.status, "declined");
  assert.equal(result.order.status, "pending_payment");
  assert.deepEqual(replay, result);
  const retried = await payOrder.execute(order.id, "pay-order-declined-retry");
  assert.equal(retried.payment.status, "approved");
  assert.equal(retried.order.status, "paid");
  assert.equal(gatewayCalls, 2);
  assert.equal((await orders.findById(order.id))?.status, "paid");
});

test("rejects payment for missing and already-paid orders", async () => {
  const orders = new InMemoryOrderRepository();
  const gateway: PaymentGateway = {
    processPayment: async () => ({ approved: true, transactionId: "sim-tx-1" }),
  };
  const payOrder = new PayOrder(orders, gateway);

  await assert.rejects(payOrder.execute("missing", "missing-order-key"), OrderNotFoundError);

  const order = makeOrder();
  order.markAsPaid();
  await orders.save(order);
  await assert.rejects(payOrder.execute(order.id, "another-key"), OrderAlreadyPaidError);
});

test("replays a payment result for the same idempotency key without calling the gateway twice", async () => {
  const orders = new InMemoryOrderRepository();
  const order = makeOrder();
  await orders.save(order);
  let gatewayCalls = 0;
  const gateway: PaymentGateway = {
    processPayment: async () => {
      gatewayCalls += 1;
      return { approved: true, transactionId: "sim-tx-replay" };
    },
  };
  const payOrder = new PayOrder(orders, gateway);

  const first = await payOrder.execute(order.id, "same-key");
  const replay = await payOrder.execute(order.id, "same-key");

  assert.equal(gatewayCalls, 1);
  assert.deepEqual(replay, first);
  await assert.rejects(payOrder.execute(order.id, "new-payment-key"), OrderAlreadyPaidError);
});

test("prevents concurrent payments from charging the same order more than once", async () => {
  const orders = new InMemoryOrderRepository();
  const order = makeOrder();
  await orders.save(order);
  let gatewayCalls = 0;
  const gateway: PaymentGateway = {
    processPayment: async () => {
      gatewayCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { approved: true, transactionId: "sim-tx-concurrent" };
    },
  };
  const payOrder = new PayOrder(orders, gateway);

  const results = await Promise.all([
    payOrder.execute(order.id, "concurrent-key"),
    payOrder.execute(order.id, "concurrent-key"),
  ]);

  assert.equal(gatewayCalls, 1);
  assert.deepEqual(results[0], results[1]);
});

test("does not persist idempotency after a gateway failure and allows retry", async () => {
  const orders = new InMemoryOrderRepository();
  const order = makeOrder();
  await orders.save(order);
  let gatewayCalls = 0;
  const gateway: PaymentGateway = {
    processPayment: async () => {
      gatewayCalls += 1;
      if (gatewayCalls === 1) {
        throw new Error("Gateway unavailable");
      }
      return { approved: true, transactionId: "sim-tx-retry" };
    },
  };
  const payOrder = new PayOrder(orders, gateway);

  await assert.rejects(payOrder.execute(order.id, "retry-key"), /Gateway unavailable/);
  const retried = await payOrder.execute(order.id, "retry-key");

  assert.equal(gatewayCalls, 2);
  assert.equal(retried.payment.transactionId, "sim-tx-retry");
  assert.equal(retried.order.status, "paid");
});

test("recovers when the gateway authorized a payment but its response was lost", async () => {
  const orders = new InMemoryOrderRepository();
  const order = makeOrder();
  await orders.save(order);
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
      const result = { approved: true, transactionId: "provider-authorization-1" };
      providerResults.set(idempotencyKey, result);
      throw new Error("Response lost after provider authorization");
    },
  };
  const payOrder = new PayOrder(orders, gateway);

  await assert.rejects(
    payOrder.execute(order.id, "lost-response-key"),
    /Response lost after provider authorization/,
  );
  const recovered = await payOrder.execute(order.id, "lost-response-key");

  assert.equal(requests, 2);
  assert.equal(authorizations, 1);
  assert.equal(recovered.payment.transactionId, "provider-authorization-1");
  assert.equal(recovered.order.status, "paid");
});

test("rejects reuse of an idempotency key for a different order", async () => {
  const orders = new InMemoryOrderRepository();
  const firstOrder = makeOrder();
  const secondOrder = Order.create(
    "order-2",
    [{ productId: "product-2", quantity: 1, unitPriceCents: 100 }],
    new Date("2026-10-20T12:00:00.000Z"),
  );
  await orders.save(firstOrder);
  await orders.save(secondOrder);
  const gateway: PaymentGateway = {
    processPayment: async () => ({ approved: false, transactionId: "sim-tx-1" }),
  };
  const payOrder = new PayOrder(orders, gateway);

  await payOrder.execute(firstOrder.id, "shared-key");
  await assert.rejects(payOrder.execute(secondOrder.id, "shared-key"), /different order/);
});

test("rejects invalid state transitions in the domain", () => {
  const order = makeOrder();
  order.markAsPaid();
  assert.throws(() => order.markAsPaid(), /Only orders pending payment/);
});
