import { compareGenerated } from './generation.ts';
import { checkContracts } from './check-contracts.ts';
await checkContracts();
await compareGenerated();
