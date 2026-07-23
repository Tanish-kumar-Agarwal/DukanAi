import type { NextAuthOptions, User, Account, Profile } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import { clientConfig, serverConfig } from '../config/env';

// ---------------------------------------------------------------------------
// Augmented user payload — what our NestJS backend returns and what we store
// in the NextAuth JWT / session.  These fields do not exist on the upstream
// NextAuth User type, so we model them explicitly.
// ---------------------------------------------------------------------------
interface DukaanUser extends User {
  role: string;
  shopId: string;
  accessToken: string;
  refreshToken: string;
}

function isDukaanUser(u: User): u is DukaanUser {
  return 'accessToken' in u && 'refreshToken' in u && 'role' in u && 'shopId' in u;
}

// ---------------------------------------------------------------------------
// API helper — called from both the Credentials authorize and the Google
// signIn callback so the backend is always the single source of truth.
// ---------------------------------------------------------------------------
const API_URL = clientConfig.NEXT_PUBLIC_API_URL;

/** Message surfaced on the login form when the backend cannot be reached. */
export const API_UNREACHABLE_MESSAGE = `The DukaanAI API at ${API_URL} is unreachable. Make sure the backend server is running, then try again.`;

type ProvisionResult =
  | { ok: true; user: DukaanUser }
  | { ok: false; reason: 'rejected' | 'unreachable' };

async function provisionUserFromBackend(
  payload: Record<string, unknown>,
): Promise<ProvisionResult> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/${payload.googleId ? 'google' : 'login'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    // fetch only rejects on network-level failures — the API is down/unreachable.
    console.error(`Auth backend unreachable at ${API_URL}:`, error);
    return { ok: false, reason: 'unreachable' };
  }

  try {
    const data = await res.json();

    if (res.ok && data?.access_token) {
      return {
        ok: true,
        user: {
          id: data.user.id,
          name: data.user.name,
          email: data.user.email,
          role: data.user.role,
          shopId: data.user.shopId,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
        },
      };
    }
    console.error(`Auth backend rejected sign-in (HTTP ${res.status}):`, data);
    return { ok: false, reason: 'rejected' };
  } catch (error) {
    console.error('Auth backend returned an unreadable response:', error);
    return { ok: false, reason: 'rejected' };
  }
}

// ---------------------------------------------------------------------------
// NextAuth configuration
// ---------------------------------------------------------------------------
export const authOptions: NextAuthOptions = {
  secret: serverConfig.NEXTAUTH_SECRET,
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },

  providers: [
    // ---- Email / password ----
    CredentialsProvider({
      id: 'credentials',
      name: 'Email & Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const result = await provisionUserFromBackend({
          email: credentials.email,
          password: credentials.password,
        });
        if (result.ok) return result.user;
        if (result.reason === 'unreachable') {
          // Thrown message becomes `result.error` on the client so the login
          // form can distinguish "API down" from "wrong password".
          throw new Error(API_UNREACHABLE_MESSAGE);
        }
        return null;
      },
    }),

    // ---- Google OAuth ----
    ...(serverConfig.GOOGLE_CLIENT_ID && serverConfig.GOOGLE_CLIENT_SECRET
      ? [GoogleProvider({
          clientId: serverConfig.GOOGLE_CLIENT_ID,
          clientSecret: serverConfig.GOOGLE_CLIENT_SECRET,
          authorization: {
            params: {
              prompt: 'select_account',
              access_type: 'offline',
            },
          },
        })]
      : []),
  ],

  callbacks: {
    // ---- signIn — provision user in our backend on first Google sign-in ----
    async signIn({ user, account }: { user: User; account: Account | null; profile?: Profile }) {
      // Credentials provider already handled in authorize — allow through
      if (account?.provider === 'credentials') return true;

      // Google OAuth — the user object carries name/email from Google;
      // we need to provision this identity in our backend to get role/shopId/accessToken.
      if (account?.provider === 'google') {
        const provisioned = await provisionUserFromBackend({
          googleId: account.providerAccountId,
          email: user.email,
          name: user.name,
        });

        if (!provisioned.ok) return false;

        // Mutate the user object so the jwt callback receives our fields.
        // NextAuth v4 copies properties from user → token.user in the jwt
        // callback, so we must enrich user *before* that callback fires.
        Object.assign(user, provisioned.user);
        return true;
      }

      return false;
    },

    // ---- jwt — persist Dukaan fields into the token ----
    async jwt({ token, user, trigger }) {
      if (user && isDukaanUser(user)) {
        token.id = user.id;
        token.role = user.role;
        token.shopId = user.shopId;
        token.accessToken = user.accessToken;
      }

      // On session update (e.g. profile change), re-fetch from backend.
      // Not yet implemented — placeholder for future use.
      void trigger;

      return token;
    },

    // ---- session — expose Dukaan fields to the client ----
    async session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as string;
      session.user.shopId = token.shopId as string;
      session.accessToken = token.accessToken as string;
      return session;
    },
  },

  // Debug only in development
  debug: serverConfig.NODE_ENV === 'development',
};
