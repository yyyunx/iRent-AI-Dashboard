import { AuthSessionRecord, SafeUser } from '../models/types';

declare global {
  namespace Express {
    interface Request {
      authUser?: SafeUser;
      authSession?: AuthSessionRecord;
      authSessionToken?: string;
    }
  }
}

export {};
