import assert from "node:assert/strict";
import test from "node:test";
import { Order } from "../src/domain/order.js";
import { OrderAlreadyPaidError, OrderNotFoundError, PayOrder } from "../src/application/use-cases/pay-order.js";
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

  const result = await new PayOrder(orders, gateway).execute(order.id);

  assert.equal(chargedOrderId, "order-1");
  assert.equal(chargedAmount, 2500);
  assert.equal(result.payment.status, "approved");
  assert.equal(result.payment.transactionId, "sim-tx-1");
  assert.equal(result.order.status, "paid");
  assert.equal((await orders.findById(order.id))?.status, "paid");
});

test("leaves an order pending when payment is declined", async () => {
  const orders = new InMemoryOrderRepository();
  const order = makeOrder();
  await orders.save(order);
  const gateway: PaymentGateway = {
    processPayment: async () => ({ approved: false, transactionId: "sim-tx-declined" }),
  };

  const result = await new PayOrder(orders, gateway).execute(order.id);

  assert.equal(result.payment.status, "declined");
  assert.equal(result.order.status, "pending_payment");
  assert.equal((await orders.findById(order.id))?.status, "pending_payment");
});

test("rejects payment for missing and already-paid orders", async () => {
  const orders = new InMemoryOrderRepository();
  const gateway: PaymentGateway = {
    processPayment: async () => ({ approved: true, transactionId: "sim-tx-1" }),
  };
  const payOrder = new PayOrder(orders, gateway);

  await assert.rejects(payOrder.execute("missing"), OrderNotFoundError);

  const order = makeOrder();
  order.markAsPaid();
  await orders.save(order);
  await assert.rejects(payOrder.execute(order.id), OrderAlreadyPaidError);
});
