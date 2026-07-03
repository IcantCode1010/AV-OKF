import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getWorkspaceLlmSetting } from "@/lib/llm-provider-settings";
import { getLlmProvider, LLM_PROVIDERS } from "@/lib/llm-providers";
import { getCurrentUser, getCurrentWorkspace } from "@/lib/mock-data";
import { redirect } from "next/navigation";

import {
  clearLlmSettingsAction,
  saveLlmSettingsAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { user, workspace } = await getSettingsShellContext();
  const context = await requireAuthWorkspaceContext();
  const llmSetting = await getWorkspaceLlmSetting(context.workspaceId);
  const selectedProvider = getLlmProvider(llmSetting.provider);

  return (
    <>
      <div>
        <Badge variant="secondary">Settings shell</Badge>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Settings
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Mock workspace and profile settings. Real auth, roles, and tenant
          controls are intentionally deferred.
        </p>
      </div>

      <Tabs defaultValue="workspace" className="w-full">
        <TabsList>
          <TabsTrigger value="workspace">Workspace</TabsTrigger>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="ai">AI Enrichment</TabsTrigger>
        </TabsList>
        <TabsContent value="workspace" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Workspace</CardTitle>
              <CardDescription>
                Modeled settings for the Stage 0 shell.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="workspace-name">Workspace name</Label>
                <Input id="workspace-name" value={workspace.name} readOnly />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="workspace-plan">Plan</Label>
                <Input id="workspace-plan" value={workspace.plan} readOnly />
              </div>
              <Separator />
              <Button disabled>Save settings in later stage</Button>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="profile" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>
                Mock identity used to exercise authenticated layouts.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={user.name} readOnly />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={user.email} readOnly />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <Label htmlFor="role">Role</Label>
                <Input id="role" value={user.role} readOnly />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="ai" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>AI Enrichment</CardTitle>
                  <CardDescription>
                    Store the workspace API key used by future topic enrichment.
                  </CardDescription>
                </div>
                <Badge variant={llmSetting.hasKey ? "secondary" : "outline"}>
                  {llmSetting.hasKey
                    ? `Key configured (${selectedProvider.label})`
                    : "No key stored"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="llm-provider">Provider</Label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                    defaultValue={selectedProvider.id}
                    form="llm-settings-form"
                    id="llm-provider"
                    name="provider"
                  >
                    {LLM_PROVIDERS.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="llm-updated">Last updated</Label>
                  <Input
                    id="llm-updated"
                    value={
                      llmSetting.updatedAt
                        ? formatSettingsTimestamp(llmSetting.updatedAt)
                        : "Not configured"
                    }
                    readOnly
                  />
                </div>
              </div>

              <form
                action={saveLlmSettingsAction}
                className="space-y-3"
                id="llm-settings-form"
              >
                <input
                  type="hidden"
                  name="workspaceId"
                  value={context.workspaceId}
                />
                <div className="grid gap-2">
                  <Label htmlFor="llm-api-key">Provider API key</Label>
                  <Input
                    id="llm-api-key"
                    name="apiKey"
                      placeholder={
                        llmSetting.hasKey
                          ? "Enter a new key to replace the stored key"
                          : "Paste provider API key"
                      }
                    type="password"
                  />
                  <p className="text-xs text-muted-foreground">
                    The key is encrypted before storage and is never displayed
                    again after saving.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Switching providers requires entering a new API key.
                  </p>
                </div>
                <PendingSubmitButton pendingLabel="Saving...">
                  Save API key
                </PendingSubmitButton>
              </form>

              <Separator />

              <form action={clearLlmSettingsAction}>
                <input
                  type="hidden"
                  name="workspaceId"
                  value={context.workspaceId}
                />
                <Button
                  disabled={!llmSetting.hasKey}
                  type="submit"
                  variant="outline"
                >
                  Clear stored key
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="sources" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Source policy</CardTitle>
              <CardDescription>
                Placeholder controls for future document governance.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              {[
                "Accepted file types",
                "Review status defaults",
                "Source authority fields",
              ].map((item) => (
                <div key={item} className="rounded-md border border-border p-4">
                  <p className="text-sm font-medium">{item}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Configurable when ingestion and review workflows are added.
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

async function getSettingsShellContext() {
  if (process.env.AV_OKF_BACKEND === "production") {
    const { getProductionShellContext } = await import("@/lib/auth");
    const shell = await getProductionShellContext();

    if (!shell) {
      redirect("/api/auth/signin");
    }

    return shell;
  }

  return {
    user: getCurrentUser(),
    workspace: getCurrentWorkspace(),
  };
}

function formatSettingsTimestamp(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
