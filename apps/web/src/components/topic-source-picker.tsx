"use client";
import Link from "next/link";
import { useState } from "react";
type Source = {id:string;title:string;collection:string;pages:number;ready:boolean};
export function TopicSourcePicker({documents,collections,initialDocuments=[],initialCollections=[]}:{documents:Source[];collections:{id:string;name:string}[];initialDocuments?:string[];initialCollections?:string[]}) {
 const [mode,setMode]=useState(initialCollections.length?"collections":"documents");
 const [query,setQuery]=useState("");
 const [selected,setSelected]=useState<string[]>(initialDocuments);
 const visible=documents.filter(d=>`${d.title} ${d.collection}`.toLowerCase().includes(query.toLowerCase()));
 return <fieldset className="space-y-3 rounded-md border p-3">
  <legend className="px-2 text-sm font-medium">Use existing sources</legend>
  <div className="flex flex-wrap gap-4 text-sm">
   <label><input type="radio" name="sourceMode" value="documents" checked={mode==="documents"} onChange={()=>setMode("documents")}/> Select documents</label>
   <label><input type="radio" name="sourceMode" value="collections" checked={mode==="collections"} onChange={()=>setMode("collections")}/> Entire collections</label>
  </div>
  {mode==="documents" ? <>
   <p className="text-xs text-muted-foreground">Choose sources already uploaded to your workspace. No re-upload needed. Refresh checks these same documents; use entire collections to include future additions.</p>
   <label className="block text-sm">Find a source<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search document titles or collections" className="mt-1 block w-full rounded-md border bg-background p-2"/></label>
   <p role="status" className="text-xs text-muted-foreground">{selected.length} selected · {visible.length} matching documents</p>
   {selected.map(id=><input key={id} type="hidden" name="documentIds" value={id}/>)}
   <div className="max-h-80 space-y-2 overflow-y-auto">{visible.map(d=><div key={d.id} className="rounded-md border p-3 text-sm">
    <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={selected.includes(d.id)} disabled={!d.ready} onChange={e=>setSelected(old=>e.target.checked?[...old,d.id]:old.filter(id=>id!==d.id))}/><span className="min-w-0 break-words"><span className="font-medium">{d.title}</span><span className="block text-xs text-muted-foreground">{d.collection} · {d.pages} pages · {d.ready?"Ready":"Extraction needs attention"}</span></span></label>
    <Link href={`/documents/${d.id}`} className="ml-5 mt-1 inline-block text-xs underline">View source</Link>
   </div>)}</div>
   {!visible.length&&<p className="text-sm text-muted-foreground">No matching sources. <Link href="/documents" className="underline">Open your document library</Link>.</p>}
  </> : <>
   <p className="text-xs text-muted-foreground">Check every active document in the selected collections. New documents are included on refresh. All documents must finish extraction before generating.</p>
   <div className="grid gap-2 md:grid-cols-2">{collections.map(c=><label key={c.id} className="flex gap-2 text-sm"><input type="checkbox" name="collectionIds" value={c.id} defaultChecked={initialCollections.includes(c.id)}/>{c.name}</label>)}</div>
  </>}
 </fieldset>;
}
