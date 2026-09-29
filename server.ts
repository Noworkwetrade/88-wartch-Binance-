/**
 * Root Server Entrypoint
 */
import { startServer } from './server/index.js';

startServer().catch((err) => {
  console.error('[server] Fatal error:', err);
  process.exit(1);
});
