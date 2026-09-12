import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getPrisma } from "@/lib/prisma";
import { nativeFiles, type BuilderResult } from "@/lib/topic-builder-core";
import { getBuilderCorpus } from "@/lib/topic-builder";
import { zipTextFiles } from "@/lib/topic-builder-zip";
export const runtime="nodejs";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const context=await requireAuthWorkspaceContext();
  const run=await getPrisma().topicBuilderRun.findFirst({where:{id:(await params).id,workspaceId:context.workspaceId,status:"approved"},include:{recipe:true}});
  if(!run?.result)return Response.json({error:"revision_not_found"},{status:404});
  const corpus=await getBuilderCorpus(context.workspaceId,run.recipe.collectionIds,run.recipe.documentIds);
  if(corpus.fingerprint!==run.fingerprint)return Response.json({error:"Sources changed. Refresh and review this bundle before exporting."},{status:409});
  const files=nativeFiles(run.recipe,run.result as unknown as BuilderResult,run.id,run.approvedBy!,run.approvedAt!.toISOString());
  const bytes=zipTextFiles(files);
  return new Response(new Uint8Array(bytes),{headers:{"Content-Type":"application/zip","Content-Disposition":`attachment; filename="topic-bundle-${run.recipeId}.zip"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
 }catch(error){return Response.json({error:error instanceof Error&&error.message==="authentication_required"?"authentication_required":"Bundle unavailable; check source collections and authentication."},{status:error instanceof Error&&error.message==="authentication_required"?401:409});}
}
