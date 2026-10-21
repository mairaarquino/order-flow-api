import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { CreateOrder } from "../src/application/use-cases/create-order.js";
import { PayOrder } from "../src/application/use-cases/pay-order.js";
import { InMemoryOrderRepository } from "../src/infrastructure/persistence/in-memory-order-repository.js";
import { OrderController } from "../src/presentation/http/order-controller.js";
import { createHttpServer } from "../src/presentation/http/server.js";

test("HTTP requires an idempotency key and replays successful payment responses", async (t) => {
  const orders = new InMemoryOrderRepository();
  let gatewayCalls = 0;
  const createOrder = new CreateOrder(orders, { generate: () => "http-order-1" });
  const payOrder = new PayOrder(orders, {
    processPayment: async () => {
      gatewayCalls += 1;
      return { approved: true, transactionId: "http-transaction" };
    },
  });
  const server = createHttpServer(new OrderController(createOrder, payOrder));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.close();
    await once(server, "close");
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const healthResponse = await fetch(`${baseUrl}/health`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), { status: "ok" });

  const createdResponse = await fetch(`${baseUrl}/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items: [{ productId: "sku-1", quantity: 1, unitPriceCents: 725 }] }),
  });
  const created = await createdResponse.json() as { id: string; status: string };
  assert.equal(createdResponse.status, 201);
  assert.equal(created.status, "pending_payment");

  const missingKeyResponse = await fetch(`${baseUrl}/orders/${created.id}/pay`, { method: "POST" });
  assert.equal(missingKeyResponse.status, 400);

  const pay = () => fetch(`${baseUrl}/orders/${created.id}/pay`, {
    method: "POST",
    headers: { "Idempotency-Key": "http-payment-1" },
  });
  const firstResponse = await pay();
  const first = await firstResponse.json() as {
    order: { status: string };
    payment: { status: string; transactionId: string };
  };
  const replayResponse = await pay();
  const replay = await replayResponse.json();

  assert.equal(firstResponse.status, 200);
  assert.equal(first.order.status, "paid");
  assert.equal(first.payment.status, "approved");
  assert.equal(gatewayCalls, 1);
  assert.deepEqual(replay, first);
});
