# OrderFlow API

API TypeScript/Node.js com dependências direcionadas ao núcleo:

- `src/domain`: entidade `Order`, invariantes e transições de estado.
- `src/application`: casos de uso e contratos de persistência/pagamento.
- `src/infrastructure`: PostgreSQL, migrations e gateway simulado.
- `src/presentation`: adaptadores HTTP, validação e conversão de dados.
- `src/main.ts`: composição explícita das dependências.
- `migrations/`: migrations SQL transacionais.

## Requisitos e inicialização

Requer Node.js 20+ e Docker Compose. Na raiz do projeto:

```sh
npm install
docker compose up -d postgres
export DATABASE_URL=postgresql://orderflow:orderflow@localhost:5432/orderflow
npm run db:migrate
npm test
npm run build
npm start
```

A API escuta na porta `3000` por padrão. Para alterar, defina `PORT`. O PostgreSQL local publica `5432` por padrão; se essa porta já estiver ocupada, defina `POSTGRES_PORT` e ajuste a porta no `DATABASE_URL`. O processo requer `DATABASE_URL`; as migrations são executadas explicitamente antes da inicialização e podem ser reaplicadas com segurança.

## Exemplos HTTP

Verificar a disponibilidade da API:

```sh
curl -i http://localhost:3000/health
```

Resposta `200`:

```json
{"status":"ok"}
```

Criar um pedido (valores monetários em centavos inteiros):

```sh
curl -i -X POST http://localhost:3000/orders \
  -H 'content-type: application/json' \
  --data '{"items":[{"productId":"sku-1","quantity":2,"unitPriceCents":1250}]}'
```

A resposta `201` inclui `id`, total calculado e status `pending_payment`. Pague usando o ID retornado e uma chave de idempotência única para essa operação:

```sh
curl -i -X POST http://localhost:3000/orders/<order-id>/pay \
  -H 'Idempotency-Key: pay-order-001'
```

Repetir exatamente a mesma requisição com a mesma chave reproduz o resultado original sem chamar novamente o gateway. Reutilizar a chave para outro pedido retorna `409`; usar uma chave nova para um pedido já pago também retorna `409`. Um pedido inexistente retorna `404`, e a ausência de `Idempotency-Key` retorna `400`.

O gateway incluído é simulado e aprova pagamentos. Para uma integração real, o provedor deve aceitar e respeitar a chave de idempotência recebida.

## Testes

`npm test` executa testes unitários do domínio e casos de uso, além de verificações arquiteturais. Testes de transação/concorrência PostgreSQL são executados quando `ORDERFLOW_TEST_DATABASE_URL` aponta para um banco de teste já migrado:

```sh
export ORDERFLOW_TEST_DATABASE_URL=postgresql://orderflow:orderflow@localhost:5432/orderflow_test
DATABASE_URL="$ORDERFLOW_TEST_DATABASE_URL" npm run db:migrate
npm test
```

Os testes de integração criam IDs aleatórios e removem apenas os pedidos gerados por cada teste. Use um banco dedicado a testes.

## Decisões e limites

Veja [docs/architecture/adr-001-layered-architecture.md](./docs/architecture/adr-001-layered-architecture.md) para a decisão arquitetural, garantias transacionais, idempotência e limitações da integração externa.

As decisões de consistência do pagamento e recuperação de falhas parciais estão em [docs/architecture/adr-002-payment-idempotency.md](./docs/architecture/adr-002-payment-idempotency.md).
