import assert from "node:assert/strict";
import test from "node:test";
import { CreateOrder } from "../src/application/use-cases/create-order.js";
import { Order, OrderValidationError } from "../src/domain/order.js";
import type { OrderRepository } from "../src/application/ports/order-repository.js";

test("creates and persists an order with the calculated total", async () => {
  const saved: Order[] = [];
  const useCase = new CreateOrder(
    {
      save: async (order) => { saved.push(order); },
      findById: async () => null,
    },
    { generate: () => "order-1" },
    () => new Date("2026-10-20T12:00:00.000Z"),
  );

  const order = await useCase.execute({
    items: [
      { productId: "product-1", quantity: 2, unitPriceCents: 1250 },
      { productId: "product-2", quantity: 1, unitPriceCents: 500 },
    ],
  });

  assert.equal(order.id, "order-1");
  assert.equal(order.totalCents, 3000);
  assert.equal(order.createdAt.toISOString(), "2026-10-20T12:00:00.000Z");
  assert.deepEqual(saved, [order]);
});

test("does not persist an order that violates domain invariants", async () => {
  let saveCalled = false;
  const repository: OrderRepository = {
    save: async () => { saveCalled = true; },
    findById: async () => null,
  };
  const useCase = new CreateOrder(repository, { generate: () => "order-1" });

  await assert.rejects(
    useCase.execute({ items: [{ productId: "product-1", quantity: 0, unitPriceCents: 100 }] }),
    OrderValidationError,
  );
  assert.equal(saveCalled, false);
});

test("rejects unsafe order totals", () => {
  assert.throws(
    () => Order.create("order-1", [
      { productId: "product-1", quantity: Number.MAX_SAFE_INTEGER, unitPriceCents: 2 },
    ], new Date()),
    OrderValidationError,
  );
});
