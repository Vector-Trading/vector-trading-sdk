import { SignalsClient, buildOpenSignal, buildUpdateSignal } from '@vector-trading/sdk';

export async function openAndClearTargets(baseUrl: string, strategyApiKey: string): Promise<void> {
  const client = new SignalsClient({ baseUrl, strategyApiKey });
  const open = buildOpenSignal({
    version: 1,
    marketPrice: 100,
    order: { side: 'buy', stop: 90, takeProfits: [{ price: 110, percent: 100 }] },
  });
  await client.send(open);
  // Omission preserves targets; an explicit empty array clears them on update.
  await client.send(
    buildUpdateSignal({ version: 1, marketPrice: 100, order: { side: 'buy', takeProfits: [] } }),
  );
}
