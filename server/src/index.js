// Local / VPS start: listen on a port and run the SMS worker. (Vercel imports app.js instead.)
import app from './app.js';
import { startSmsWorker } from './services/sms.js';

if (!process.env.JWT_SECRET) { console.error('JWT_SECRET is not set (copy .env.example to .env)'); process.exit(1); }

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`SePOS API listening on http://localhost:${port}`);
  startSmsWorker();
});
