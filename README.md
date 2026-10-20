# OrderFlow API

API TypeScript/Node.js organizada em camadas, com as dependências apontando para o núcleo:

- `src/domain`: entidade `Order` e suas invariantes.
- `src/application`: caso de uso `CreateOrder` e contratos necessários.
- `src/infrastructure`: gerador de identificadores e repositório em memória.
- `src/presentation`: adaptadores HTTP e conversão das requisições.
- `src/main.ts`: composição explícita das implementações e inicialização do servidor.

O primeiro fluxo implementado é `POST /orders`. O corpo deve conter `items`, cada qual com `productId`, `quantity` e `unitPriceCents`. O preço e o total são representados em centavos inteiros.

O repositório em memória é uma implementação demonstrativa: os pedidos não sobrevivem ao encerramento do processo. Um adaptador de persistência durável poderá substituir essa implementação sem alterar o caso de uso.

## Executar

```sh
npm install
npm test
npm run build
npm start
```

O servidor escuta na porta `3000` por padrão; defina `PORT` para alterá-la.
# order-flow-api
