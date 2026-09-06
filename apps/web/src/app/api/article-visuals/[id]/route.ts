import {requireAuthWorkspaceContext} from "@/lib/auth-workspace";
import {getPrisma} from "@/lib/prisma";
import {getObjectStorage} from "@/lib/production-storage";
import {assertArticleSourcesCurrent} from "@/lib/knowledge/editorial";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 try{const context=await requireAuthWorkspaceContext();const v=await getPrisma().knowledgeVisual.findFirst({where:{id:(await params).id,workspaceId:context.workspaceId}});if(!v)return new Response(null,{status:404});
 await assertArticleSourcesCurrent(context,v.articleRevisionId);const bytes=await getObjectStorage().getObject((v.provenance as {objectKey:string}).objectKey);await assertArticleSourcesCurrent(context,v.articleRevisionId);
 return new Response(new Uint8Array(bytes),{headers:{"Content-Type":"image/png","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
 }catch{return new Response(null,{status:403});}
}
