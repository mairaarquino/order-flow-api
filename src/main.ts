import { Pool } from "pg";
import { CreateOrder } from "./application/use-cases/create-order.js";
import { GetOrder } from "./application/use-cases/get-order.js";
import { PayOrder } from "./application/use-cases/pay-order.js";
import { UuidGenerator } from "./infrastructure/id/uuid-generator.js";
import { SimulatedPaymentGateway } from "./infrastructure/payments/simulated-payment-gateway.js";
import { PostgresOrderRepository } from "./infrastructure/persistence/postgres-order-repository.js";
import { OrderController } from "./presentation/http/order-controller.js";
import { createHttpServer } from "./presentation/http/server.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set");
}
const pool = new Pool({ connectionString: databaseUrl });
const orders = new PostgresOrderRepository(pool);
const ids = new UuidGenerator();
const paymentGateway = new SimulatedPaymentGateway();
const createOrder = new CreateOrder(orders, ids);
const payOrder = new PayOrder(orders, paymentGateway);
const getOrder = new GetOrder(orders);
const controller = new OrderController(createOrder, payOrder, getOrder);
const server = createHttpServer(controller);
const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

server.listen(port, () => {
  console.log(`OrderFlow API listening on port ${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}
