import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";

import { getPrisma } from "./prisma.ts";
import type { AuthWorkspaceContext, WorkspaceRole } from "./auth-workspace.ts";
import type { User, Workspace } from "./document-vault.ts";

type AuthPrismaClient = ReturnType<typeof getPrisma>;
type AuthEnv = Record<string, string | undefined>;

const TEST_AUTH_EMAIL = "test@av-okf.local";
const TEST_AUTH_NAME = "AV-OKF Test User";
const TEST_AUTH_PASSWORD = "av-okf-test";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(getPrisma()) as NextAuthOptions["adapter"],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.email = user.email;
        token.name = user.name;
        token.sub = user.id;
      }
      return token;
    },
    async session({ session, token, user }) {
      if (session.user) {
        session.user.name = session.user.name ?? user?.name ?? token.name;
        session.user.email = session.user.email ?? user?.email ?? token.email;
      }
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      if (user.id) {
        await ensureDefaultWorkspace(user.id, user.name ?? user.email ?? "AV-OKF User");
      }
    },
  },
  providers: buildAuthProviders(process.env),
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  session: {
    strategy: getAuthSessionStrategy(process.env),
  },
};

export function buildAuthProviderIds(env: AuthEnv = process.env): string[] {
  const providerIds: string[] = [];

  if (env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET) {
    providerIds.push("github");
  }

  if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) {
    providerIds.push("google");
  }

  if (isTestAuthEnabled(env)) {
    providerIds.push("credentials");
  }

  return providerIds;
}

export function getAuthSessionStrategy(
  env: AuthEnv = process.env,
): "database" | "jwt" {
  return isTestAuthEnabled(env) ? "jwt" : "database";
}

export function isValidTestAuthPassword(
  password: string | undefined,
  env: AuthEnv = process.env,
): boolean {
  return Boolean(password) && password === getTestAuthPassword(env);
}

export async function getCurrentSessionWorkspace(): Promise<AuthWorkspaceContext | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;

  if (!email) {
    return null;
  }

  const prisma: AuthPrismaClient = getPrisma();
  const user = await prisma.user.findUnique({
    include: {
      memberships: {
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
    where: { email },
  });

  if (!user) {
    return null;
  }

  const membership =
    user.memberships[0] ??
    (await ensureDefaultWorkspace(user.id, user.name ?? user.email ?? "AV-OKF User"));

  return {
    role: normalizeWorkspaceRole(membership.role),
    userId: user.id,
    workspaceId: membership.workspaceId,
  };
}

export async function getProductionShellContext(): Promise<{
  user: User;
  workspace: Workspace;
} | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;

  if (!email) {
    return null;
  }

  const prisma: AuthPrismaClient = getPrisma();
  const user = await prisma.user.findUnique({
    include: {
      memberships: {
        include: { workspace: { include: { members: true } } },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
    where: { email },
  });

  if (!user) {
    return null;
  }

  const membership =
    user.memberships[0] ??
    (await ensureDefaultWorkspace(user.id, user.name ?? user.email ?? "AV-OKF User"));
  const workspace =
    membership.workspace ??
    (await prisma.workspace.findUnique({
      include: { members: true },
      where: { id: membership.workspaceId },
    }));

  if (!workspace) {
    return null;
  }

  return {
    user: {
      email: user.email ?? "",
      id: user.id,
      initials: getInitials(user.name ?? user.email ?? "User"),
      name: user.name ?? user.email ?? "AV-OKF User",
      role:
        normalizeWorkspaceRole(membership.role) === "admin"
          ? "Workspace Admin"
          : "Workspace Member",
    },
    workspace: {
      id: workspace.id,
      memberCount: workspace.members?.length ?? 1,
      name: workspace.name,
      plan: workspace.plan,
    },
  };
}

async function ensureDefaultWorkspace(userId: string, displayName: string) {
  const prisma: AuthPrismaClient = getPrisma();
  const existing = await prisma.workspaceMember.findFirst({
    orderBy: { createdAt: "asc" },
    where: { userId },
  });

  if (existing) {
    return existing;
  }

  const workspace = await prisma.workspace.create({
    data: {
      members: {
        create: {
          role: "admin",
          userId,
        },
      },
      name: `${displayName}'s Workspace`,
      plan: "Production",
    },
    include: {
      members: true,
    },
  });

  return workspace.members[0];
}

function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function normalizeWorkspaceRole(value: string): WorkspaceRole {
  return value === "admin" ? "admin" : "member";
}

function buildAuthProviders(env: AuthEnv): NextAuthOptions["providers"] {
  return [
    ...(env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET
      ? [
          GitHubProvider({
            clientId: env.AUTH_GITHUB_ID,
            clientSecret: env.AUTH_GITHUB_SECRET,
          }),
        ]
      : []),
    ...(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET
      ? [
          GoogleProvider({
            clientId: env.AUTH_GOOGLE_ID,
            clientSecret: env.AUTH_GOOGLE_SECRET,
          }),
        ]
      : []),
    ...(isTestAuthEnabled(env) ? [buildTestCredentialsProvider(env)] : []),
  ];
}

function buildTestCredentialsProvider(env: AuthEnv) {
  return CredentialsProvider({
    credentials: {
      email: {
        label: "Email",
        type: "email",
        value: getTestAuthEmail(env),
      },
      password: {
        label: "Password",
        type: "password",
      },
    },
    name: "Test Login",
    async authorize(credentials) {
      const email = normalizeEmail(credentials?.email);

      if (
        email !== getTestAuthEmail(env) ||
        !isValidTestAuthPassword(credentials?.password, env)
      ) {
        return null;
      }

      const name = getTestAuthName(env);
      const prisma: AuthPrismaClient = getPrisma();
      const user = await prisma.user.upsert({
        create: {
          email,
          name,
        },
        update: {
          name,
        },
        where: {
          email,
        },
      });

      await ensureDefaultWorkspace(user.id, user.name ?? user.email ?? name);

      return {
        email: user.email,
        id: user.id,
        name: user.name,
      };
    },
  });
}

function isTestAuthEnabled(env: AuthEnv): boolean {
  return env.AV_OKF_TEST_AUTH_ENABLED === "true";
}

function getTestAuthEmail(env: AuthEnv): string {
  return normalizeEmail(env.AV_OKF_TEST_AUTH_EMAIL) ?? TEST_AUTH_EMAIL;
}

function getTestAuthName(env: AuthEnv): string {
  return env.AV_OKF_TEST_AUTH_NAME?.trim() || TEST_AUTH_NAME;
}

function getTestAuthPassword(env: AuthEnv): string {
  return env.AV_OKF_TEST_AUTH_PASSWORD || TEST_AUTH_PASSWORD;
}

function normalizeEmail(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase() || undefined;
}
