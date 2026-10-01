import { z } from 'zod';
// Optional dynamic-code compilation is incompatible with the private site's strict CSP.
z.config({ jitless: true });
export { z };
