import { RestClient, SdkError } from '@vector-trading/sdk';

export async function listOwnedBundles(baseUrl: string, accountApiKey: string): Promise<string[]> {
  const client = new RestClient({ baseUrl, accountApiKey });
  const names: string[] = [];
  try {
    for await (const page of client.listBundlesPages({ limit: 50 })) {
      for (const bundle of page.bundles) names.push(bundle.name);
    }
  } catch (error) {
    if (error instanceof SdkError && error.status === 429) {
      // Let the caller choose when to retry; the SDK never retries automatically.
      throw error;
    }
    throw error;
  }
  return names;
}
