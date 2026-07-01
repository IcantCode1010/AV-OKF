import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { getCurrentUser, getCurrentWorkspace } from "@/lib/mock-data";

export default function SettingsPage() {
  const user = getCurrentUser();
  const workspace = getCurrentWorkspace();

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
