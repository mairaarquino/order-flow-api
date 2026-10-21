import express, { type ErrorRequestHandler, type Response } from "express";
import { createServer, type Server } from "node:http";
import {
  InvalidIdempotencyKeyError,
  OrderAlreadyPaidError,
  OrderNotFoundError,
} from "../../application/use-cases/pay-order.js";
import { IdempotencyConflictError } from "../../application/ports/payment-repository.js";
import { InvalidRequestError, OrderController } from "./order-controller.js";

function sendError(response: Response, error: unknown, operation: string): void {
  if (error instanceof InvalidRequestError || error instanceof InvalidIdempotencyKeyError) {
    response.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof URIError) {
    response.status(400).json({ error: "Order id is not valid URL encoding" });
    return;
  }
  if (error instanceof IdempotencyConflictError || error instanceof OrderAlreadyPaidError) {
    response.status(409).json({ error: error.message });
    return;
  }
  if (error instanceof OrderNotFoundError) {
    response.status(404).json({ error: error.message });
    return;
  }

  console.error(`Failed to ${operation}`, error);
  response.status(500).json({ error: "Internal server error" });
}

const bodyParserErrorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  if (typeof error === "object" && error !== null && "type" in error) {
    const parserError = error as { type?: string };
    if (parserError.type === "entity.parse.failed") {
      response.status(400).json({ error: "Request body must be valid JSON" });
      return;
    }
    if (parserError.type === "entity.too.large") {
      response.status(413).json({ error: "Request body exceeds the 1 MiB limit" });
      return;
    }
  }
  next(error);
};

export function createHttpServer(controller: OrderController): Server {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.post("/orders", async (request, response) => {
    try {
      const order = await controller.create(request.body);
      response.status(201).json(order);
    } catch (error) {
      sendError(response, error, "create order");
    }
  });

  app.post("/orders/:id/pay", async (request, response) => {
    try {
      const header = request.headers["idempotency-key"];
      if (typeof header !== "string") {
        throw new InvalidRequestError("Idempotency-Key header is required");
      }
      const result = await controller.pay(request.params.id, header);
      response.status(200).json(result);
    } catch (error) {
      sendError(response, error, "process order payment");
    }
  });

  app.use(bodyParserErrorHandler);
  app.use((_request, response) => {
    response.status(404).json({ error: "Not found" });
  });

  return createServer(app);
}
