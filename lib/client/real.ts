// RealIncidentClient (docs/PLAN.md 6.4). Work in progress (A4): this stub keeps the
// factory import stable for lib/client/index.ts until the real client lands.

import type { IncidentClient } from './types';

export function createRealIncidentClient(): IncidentClient {
  throw new Error('RealIncidentClient is not available yet (A4 in progress)');
}
