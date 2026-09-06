import {readdir,readFile,realpath} from "node:fs/promises";
import path from "node:path";
import {requireAuthWorkspaceContext} from "@/lib/auth-workspace";
import {getPrisma} from "@/lib/prisma";
import {assertArticleSourcesCurrent} from "@/lib/knowledge/editorial";
import {knowledgeFeature} from "@/lib/knowledge/contracts";
import {zipTextFiles} from "@/lib/topic-builder-zip";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  if(!knowledgeFeature("export"))return new Response(null,{status:404});
  const context=await requireAuthWorkspaceContext(),{id}=await params;
  const release=await getPrisma().knowledgeExportRelease.findFirstOrThrow({where:{id,workspaceId:context.workspaceId,status:"exported"}});
  const selections=release.selectionSnapshot as Array<{revisionId:string}>;
  for(const s of selections)await assertArticleSourcesCurrent(context,s.revisionId);
  const root=await realpath(process.env.AV_OKF_EFB_RELEASE_ROOT??"/data/efb-releases");
  const directory=await realpath((release.result as {releaseDirectory:string}).releaseDirectory);
  const relative=path.relative(root,directory);if(relative.startsWith("..")||path.isAbsolute(relative))throw Error("unavailable");
  const files:Record<string,Buffer>={};let bytes=0;
  async function collect(dir:string,prefix=""){
   for(const entry of await readdir(dir,{withFileTypes:true})){
    if(entry.isSymbolicLink())throw Error("unavailable");
    const name=prefix+entry.name;
    if(entry.isDirectory())await collect(path.join(dir,entry.name),`${name}/`);
    else if(entry.isFile()){const data=await readFile(path.join(dir,entry.name));bytes+=data.length;if(bytes>100_000_000)throw Error("download_too_large");files[name]=data;}
   }
  }
  await collect(directory);for(const s of selections)await assertArticleSourcesCurrent(context,s.revisionId);
  return new Response(new Uint8Array(zipTextFiles(files)),{headers:{"Content-Type":"application/zip","Content-Disposition":`attachment; filename="${id}.zip"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
 }catch{return new Response("Export unavailable or affected sources require review.",{status:409});}
}
