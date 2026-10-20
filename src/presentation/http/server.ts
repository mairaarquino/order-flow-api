import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { OrderAlreadyPaidError, OrderNotFoundError } from "../../application/use-cases/pay-order.js";
import { InvalidRequestError, OrderController } from "./order-controller.js";

const MAX_BODY_BYTES = 1_048_576;

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      tooLarge = true;
    } else {
      chunks.push(buffer);
    }
  }

  if (tooLarge) {
    throw new InvalidRequestError("Request body exceeds the 1 MiB limit");
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new InvalidRequestError("Request body must be valid JSON");
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export function createHttpServer(controller: OrderController): Server {
  return createServer(async (request, response) => {
    const paymentRoute = request.url?.match(/^\/orders\/([^/]+)\/pay$/);
    if (request.method === "POST" && paymentRoute) {
      try {
        const orderId = decodeURIComponent(paymentRoute[1]);
        const result = await controller.pay(orderId);
        sendJson(response, 200, result);
      } catch (error) {
        if (error instanceof URIError) {
          sendJson(response, 400, { error: "Order id is not valid URL encoding" });
          return;
        }
        if (error instanceof OrderNotFoundError) {
          sendJson(response, 404, { error: error.message });
          return;
        }
        if (error instanceof OrderAlreadyPaidError) {
          sendJson(response, 409, { error: error.message });
          return;
        }
        console.error("Failed to process order payment", error);
        sendJson(response, 500, { error: "Internal server error" });
      }
      return;
    }

    if (request.method !== "POST" || request.url !== "/orders") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }

    try {
      const body = await readJson(request);
      const order = await controller.create(body);
      sendJson(response, 201, order);
    } catch (error) {
      if (error instanceof InvalidRequestError) {
        sendJson(response, 400, { error: error.message });
        return;
      }
      console.error("Failed to create order", error);
      sendJson(response, 500, { error: "Internal server error" });
    }
  });
}
