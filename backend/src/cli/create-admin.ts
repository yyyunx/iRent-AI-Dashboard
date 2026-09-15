import dotenv from 'dotenv';
import path from 'path';
import { AuthService } from '../auth/AuthService';
import { DatabaseRepository } from '../repositories/DatabaseRepository';

dotenv.config();

async function main() {
  const dbPath = process.env.DATABASE_PATH || path.resolve(__dirname, '../../../outputs/irent_ops.db');
  const email = String(process.env.ADMIN_EMAIL || '').trim();
  const password = String(process.env.ADMIN_INITIAL_PASSWORD || '');
  if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_INITIAL_PASSWORD for this one-time command.');

  const repo = new DatabaseRepository(dbPath);
  try {
    if (repo.countAdmins() > 0) throw new Error('An admin already exists; no account or password was changed.');
    const auth = new AuthService(repo);
    const admin = await auth.createUser(email, password, 'admin');
    repo.addAuditLog(admin.id, 'BOOTSTRAP_ADMIN', 'user', String(admin.id), {});
    console.log(`Created initial admin: ${admin.email}. Unset ADMIN_INITIAL_PASSWORD now.`);
  } finally {
    repo.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Failed to create admin.');
  process.exitCode = 1;
});
