export interface PaymentRequest {
  readonly orderId: string;
  readonly amountCents: number;
}

export interface PaymentResult {
  readonly approved: boolean;
  readonly transactionId: string;
}

export interface PaymentGateway {
  processPayment(request: PaymentRequest): Promise<PaymentResult>;
}
