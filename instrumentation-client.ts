// Runs in the browser before any app module (Next.js instrumentation-client).
//
// Zod 4 decides whether to JIT-compile object schemas by trying `new Function('')`
// the first time a z.object() is defined. The throw is caught, but under our
// production CSP (no 'unsafe-eval') browsers still log it and fire a
// securitypolicyviolation. jitless gives the same validation without the probe.
// It has to run here because lib/protocol and lib/legal define schemas at import.
import { config } from 'zod';

config({ jitless: true });
