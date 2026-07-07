import dotenv from 'dotenv';
import path from 'path';
import { createApp } from './app';

dotenv.config();

const PORT = parseInt(process.env.PORT || '5188', 10);
const DB_PATH = process.env.DATABASE_PATH || path.resolve(__dirname, '../../outputs/irent_ops.db');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(__dirname, '../../outputs/uploads');

console.log(`Starting iRent Ops Backend...`);
console.log(`- Database path: ${DB_PATH}`);
console.log(`- Uploads directory: ${UPLOAD_DIR}`);

const app = createApp(DB_PATH, UPLOAD_DIR);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`iRent Ops Backend listening at http://localhost:${PORT}`);
  console.log(`Healthcheck available at http://localhost:${PORT}/healthz`);
});
