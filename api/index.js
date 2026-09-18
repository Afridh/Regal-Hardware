// Vercel serverless entry: the whole Express API as one function.
// vercel.json rewrites /api/*, /shift-api.php and /reports/* here; Express sees the original URL.
import app from '../server/src/app.js';
export default app;
