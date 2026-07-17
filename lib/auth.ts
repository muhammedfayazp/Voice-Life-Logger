import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import type { JWT } from "next-auth/jwt";

// Minimal scope: just enough to create events on the primary calendar.
// (calendar.events, NOT the full "calendar" scope, and no readonly/list
// access beyond what's needed to insert.)
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: token.refreshToken as string,
      }),
    });

    const refreshed = await res.json();
    if (!res.ok) throw refreshed;

    return {
      ...token,
      accessToken: refreshed.access_token,
      expiresAt: Date.now() + refreshed.expires_in * 1000,
      // Google may not always return a new refresh_token; keep the old one.
      refreshToken: refreshed.refresh_token ?? token.refreshToken,
    };
  } catch (err) {
    console.error("Failed to refresh Google access token:", err);
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: GOOGLE_SCOPES,
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account }) {
      // First sign-in: persist tokens from the OAuth account.
      if (account) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: (account.expires_at ?? 0) * 1000,
        };
      }

      if (token.expiresAt && Date.now() < (token.expiresAt as number)) {
        return token;
      }

      return refreshAccessToken(token);
    },
    async session({ session, token }) {
      // Intentionally do NOT attach accessToken/refreshToken here — this
      // object is sent to the browser. Server-side API routes read the
      // token directly via next-auth/jwt's getToken() instead, so the
      // Google access token never reaches client JS.
      if (token.error) {
        (session as typeof session & { error?: string }).error = token.error as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
};
