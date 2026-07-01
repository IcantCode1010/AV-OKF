import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";

import { getPrisma } from "./prisma.ts";
import type { AuthWorkspaceContext, WorkspaceRole } from "./auth-workspace.ts";
import type { User, Workspace } from "./document-vault.ts";

type AuthPrismaClient = ReturnType<typeof getPrisma>;

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(getPrisma()) as NextAuthOptions["adapter"],
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.name = session.user.name ?? user.name;
        session.user.email = session.user.email ?? user.email;
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
  providers: [
    ...(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET
      ? [
          GitHubProvider({
            clientId: process.env.AUTH_GITHUB_ID,
            clientSecret: process.env.AUTH_GITHUB_SECRET,
          }),
        ]
      : []),
    ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
          }),
        ]
      : []),
  ],
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "database",
  },
};

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
