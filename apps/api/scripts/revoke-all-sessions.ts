/**
 * Ends every session, or one user's (roadmap 9.11: the step after a
 * JWT_SECRET rotation, and the incident-response lever).
 *
 *     npm run sessions:revoke-all -- --yes                 # everyone
 *     npm run sessions:revoke-all -- --user <id|email> --yes
 *     npm run sessions:revoke-all                           # dry run: counts only
 *
 * Revokes every live refresh token and bumps `tokenVersion`
 * (`src/auth/session-revocation.ts`), in one transaction: every access token
 * minted before now is refused and no refresh can mint a new one, so every
 * browser and socket signs in again. Nothing else changes: passwords, shops
 * and data are untouched. Exit 0 on success, 2 on a usage or connection
 * error. `DATABASE_URL` is read from the environment or `.env.local` / `.env`
 * in apps/api, as the API reads it.
 */
import { parseArgs } from 'node:util';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { countSessions, revokeAllSessions } from '../src/auth/session-revocation';

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(2);
}

function parse(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      user: { type: 'string' },
      yes: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log('usage: revoke-all-sessions [--user <id|email>] [--yes]   (without --yes: a dry run)');
    process.exit(0);
  }
  return { user: values.user, yes: values.yes === true };
}

async function main(): Promise<number> {
  dotenv.config({ path: '.env.local' });
  dotenv.config();
  const { user, yes } = parse(process.argv.slice(2));
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set');

  const prisma = new PrismaClient();
  try {
    let userId: string | undefined;
    if (user) {
      const row = await prisma.user.findFirst({ where: user.includes('@') ? { email: user } : { id: user }, select: { id: true, email: true } });
      if (!row) fail(`no user matches "${user}"`);
      userId = row.id;
      console.log(`Scope: user ${row.email} (${row.id})`);
    } else {
      console.log('Scope: every user');
    }
    const before = await countSessions(prisma, { userId });
    console.log(`Live refresh tokens: ${before.refreshTokensRevoked}; users whose tokenVersion will advance: ${before.usersBumped}`);
    if (!yes) {
      console.log('Dry run: nothing changed. Pass --yes to end these sessions.');
      return 0;
    }
    const result = await revokeAllSessions(prisma, { userId });
    console.log(`Done: ${result.refreshTokensRevoked} refresh token(s) revoked, tokenVersion advanced for ${result.usersBumped} user(s). Every access token minted before now is refused; restart the API if JWT_SECRET changed so open sockets drop too.`);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => fail((error as Error).message ?? String(error)),
);
