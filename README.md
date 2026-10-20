# OrderFlow API

API TypeScript/Node.js organizada em camadas, com as dependências apontando para o núcleo:

- `src/domain`: entidade `Order` e suas invariantes.
- `src/application`: caso de uso `CreateOrder` e contratos necessários.
- `src/infrastructure`: gerador de identificadores e repositório em memória.
- `src/presentation`: adaptadores HTTP e conversão das requisições.
- `src/main.ts`: composição explícita das implementações e inicialização do servidor.

Os fluxos implementados são `POST /orders` e `POST /orders/:id/pay`. A criação recebe `items`, cada qual com `productId`, `quantity` e `unitPriceCents`. O preço e o total são representados em centavos inteiros. O pagamento usa o total calculado pelo domínio, não um valor informado pelo cliente.

O pagamento é conectado à aplicação pelo contrato `PaymentGateway`; a implementação `SimulatedPaymentGateway` aprova as solicitações para fins de demonstração. Aprovações mudam o pedido para `paid`; recusas o mantêm `pending_payment`. Pedidos ausentes retornam `404` e pedidos já pagos retornam `409`.

O repositório em memória é uma implementação demonstrativa: os pedidos não sobrevivem ao encerramento do processo. O pagamento simulado não representa integração financeira real. Persistência durável, idempotência e concorrência de cobranças continuam fora deste slice.

## Executar

```sh
npm install
npm test
npm run build
npm start
```

O servidor escuta na porta `3000` por padrão; defina `PORT` para alterá-la.
# order-flow-api
