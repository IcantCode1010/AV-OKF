export type WorkspaceRole = "admin" | "member";

export type AuthWorkspaceContext = {
  role: WorkspaceRole;
  userId: string;
  workspaceId: string;
};

export function assertWorkspaceAccess(
  context: AuthWorkspaceContext,
  recordWorkspaceId: string,
) {
  if (context.workspaceId !== recordWorkspaceId) {
    throw new Error("workspace_access_denied");
  }
}

export async function requireAuthWorkspaceContext(): Promise<AuthWorkspaceContext> {
  if (process.env.AV_OKF_BACKEND !== "production") {
    return {
      role: "admin",
      userId: "usr_demo",
      workspaceId: "wrk_av_okf",
    };
  }

  const { getCurrentSessionWorkspace } = await import("./auth.ts");
  const context = await getCurrentSessionWorkspace();

  if (!context) {
    throw new Error("authentication_required");
  }

  return context;
}
