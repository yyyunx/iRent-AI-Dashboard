import dotenv from 'dotenv';
import path from 'path';
import { AuthService } from '../auth/AuthService';
import { DatabaseRepository } from '../repositories/DatabaseRepository';

dotenv.config();

function option(name: string): string {
  const prefix = `${name}=`;
  const inline = process.argv.find(argument => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '') : '';
}

async function main() {
  const dbPath = process.env.DATABASE_PATH || path.resolve(__dirname, '../../../outputs/irent_ops.db');
  const username = option('--username').trim();
  const password = String(process.env.ADMIN_INITIAL_PASSWORD || '');
  if (!username || !password) {
    throw new Error('Pass --username and set ADMIN_INITIAL_PASSWORD for this one-time command.');
  }

  const repo = new DatabaseRepository(dbPath);
  try {
    if (repo.countAdmins() > 0) throw new Error('An admin already exists; no account or password was changed.');
    const auth = new AuthService(repo);
    const admin = await auth.createUser(username, password, 'admin');
    repo.addAuditLog(admin.id, 'BOOTSTRAP_ADMIN', 'user', String(admin.id), {});
    console.log(`Created initial admin: ${admin.username}. Unset ADMIN_INITIAL_PASSWORD now.`);
  } finally {
    repo.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Failed to create admin.');
  process.exitCode = 1;
});
