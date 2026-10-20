import { CreateOrder } from "./application/use-cases/create-order.js";
import { PayOrder } from "./application/use-cases/pay-order.js";
import { UuidGenerator } from "./infrastructure/id/uuid-generator.js";
import { SimulatedPaymentGateway } from "./infrastructure/payments/simulated-payment-gateway.js";
import { InMemoryOrderRepository } from "./infrastructure/persistence/in-memory-order-repository.js";
import { OrderController } from "./presentation/http/order-controller.js";
import { createHttpServer } from "./presentation/http/server.js";

const orders = new InMemoryOrderRepository();
const ids = new UuidGenerator();
const paymentGateway = new SimulatedPaymentGateway();
const createOrder = new CreateOrder(orders, ids);
const payOrder = new PayOrder(orders, paymentGateway);
const controller = new OrderController(createOrder, payOrder);
const server = createHttpServer(controller);
const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

server.listen(port, () => {
  console.log(`OrderFlow API listening on port ${port}`);
});
