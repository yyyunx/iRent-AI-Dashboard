import dotenv from 'dotenv';
import path from 'path';
import { AuthService } from '../auth/AuthService';
import { DatabaseRepository } from '../repositories/DatabaseRepository';

dotenv.config();

async function main() {
  const dbPath = process.env.DATABASE_PATH || path.resolve(__dirname, '../../../outputs/irent_ops.db');
  const email = String(process.env.USER_EMAIL || '').trim();
  const password = String(process.env.USER_INITIAL_PASSWORD || '');
  if (!email || !password) throw new Error('Set USER_EMAIL and USER_INITIAL_PASSWORD for this one-time command.');

  const repo = new DatabaseRepository(dbPath);
  try {
    if (repo.getUserByEmail(email)) throw new Error('A user with this email already exists; no password was changed.');
    const auth = new AuthService(repo);
    const user = await auth.createUser(email, password, 'user');
    repo.addAuditLog(user.id, 'CREATE_USER', 'user', String(user.id), { source: 'cli' });
    console.log(`Created user: ${user.email}. Unset USER_INITIAL_PASSWORD now.`);
  } finally {
    repo.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Failed to create user.');
  process.exitCode = 1;
});
