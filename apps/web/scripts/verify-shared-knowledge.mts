import {queueSelectedTopicEnrichment} from "../src/lib/bulk-topic-enrichment.ts";
import {suggestArticleDiagram} from "../src/lib/knowledge/diagram-authoring.ts";
import {getKnowledgeBundleByIdentity,scaffoldKnowledgeBundle,resolveKnowledgeBundleRoot} from "../src/lib/knowledge-bundles.ts";
import {createProductionChatService} from "../src/lib/production-chat-service.ts";
import {execFileSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import {activeArticleVisuals} from "../src/lib/knowledge/visual-revisions.ts";
import { getBuilderCorpus, runTopicBuilder } from "../src/lib/topic-builder.ts";
import {
  articleEvaluationBriefs,
  researchEvaluationCases,
} from "../src/lib/knowledge/evaluation-cases.ts";
import { runRagIndexJob } from "../src/lib/rag-indexer.ts";
import { createRagRepository } from "../src/lib/rag-repository.ts";
import { retrieveDocuments } from "../src/lib/rag-backend.ts";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { exportSelectedArticles } from "../src/lib/knowledge/export.ts";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import type { Prisma, Document } from "@prisma/client";
import { getPrisma } from "../src/lib/prisma.ts";
import {
  resolveKnowledgeScope,
  validateKnowledgeScope,
} from "../src/lib/knowledge/scope.ts";
import {
  validateResearchEvidence,
  runKnowledgeResearch,
} from "../src/lib/knowledge/research.ts";
import {
  importBuilderRevision,
  assertArticleSourcesCurrent,
} from "../src/lib/knowledge/editorial.ts";
import { addArticleVisual } from "../src/lib/knowledge/media.ts";
import { getObjectStorage } from "../src/lib/production-storage.ts";
import { fingerprint } from "../src/lib/topic-builder-core.ts";
const db = getPrisma(),
  json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const workspace = await db.workspace.findFirstOrThrow({
  where: { members: { some: {} } },
  include: { members: true },
});
const context = {
    workspaceId: workspace.id,
    userId: workspace.members[0].userId,
    role: "admin" as const,
  },
  suffix = randomUUID();
const bundle = await db.knowledgeBundle.create({
  data: {
    workspaceId: workspace.id,
    createdBy: context.userId,
    name: "Shared workflow verification",
    slug: `verification-${suffix}`,
    status: "active",
  },
});
const scratch = await mkdtemp(path.join(tmpdir(), "av-okf-export-test-"));
const exportIds: string[] = [];
const chatIds:string[]=[];
let fixtureRoot:string|undefined;
const objects: string[] = [];
const runIds: string[] = [];
try {
  const docs: Array<Document & { text: string }> = [];
  for (const [title, text] of [
    [
      "Fictional training supply",
      "Training fixture only. The ALPHA-42 supply feeds the actuator through the selector. Configuration BLUE uses a mechanical selector.",
    ],
    [
      "Fictional training return",
      "Training fixture only. The ALPHA-42 actuator returns fluid through the return line. Configuration RED uses an electrical selector; do not combine its configuration with BLUE.",
    ],
  ]) {
    const d = await db.document.create({
      data: {
        workspaceId: workspace.id,
        knowledgeBundleId: bundle.id,
        title,
        fileType: "txt",
        size: "1 KB",
        sizeBytes: text.length,
        status: "ready",
        tags: ["verification"],
        updatedLabel: "now",
        owner: "Verification",
        sourceType: "aviation",
        pages: 1,
        mimeType: "text/plain",
        revision: "fixture-v1",
        effectivity: "Fictional training fixture",
        sourceAuthority: "training-reference",
        contentSha256: fingerprint(text),
      },
    });
    await db.extractedPage.create({
      data: {
        workspaceId: workspace.id,
        documentId: d.id,
        pageNumber: 1,
        text,
        tables: [],
        imageCount: 0,
        charCount: text.length,
      },
    });
    docs.push({ ...d, text });
  }
  if ((process.argv.includes("--eval")||process.argv.includes("--chat")))
    for (const d of docs) {
      const job = await createRagRepository().createIndexJob({
        workspaceId: workspace.id,
        documentId: d.id,
      });
      await runRagIndexJob({
        workspaceId: workspace.id,
        documentId: d.id,
        indexJobId: job.id,
        indexVersion: job.indexVersion,
      });
    }
  const scope = await resolveKnowledgeScope(context, {
    collectionIds: [bundle.id],
  });
  assert.equal(scope.documentIds.length, 2);
  const subset = await resolveKnowledgeScope(context, {
    documentIds: [docs[0].id],
  });
  assert.deepEqual(subset.documentIds, [docs[0].id]);
  await assert.rejects(
    () => resolveKnowledgeScope({ ...context, userId: "not-a-member" }),
    /access_denied/,
  );
  await assert.rejects(
    () => resolveKnowledgeScope(context, { collectionIds: ["missing"] }),
    /scope_unavailable/,
  );
  const evidence = docs.map((d, i) => ({
    id: `ev${i}`,
    documentId: d.id,
    documentTitle: d.title,
    collectionId: bundle.id,
    page: 1,
    quote: d.text,
    fact: d.text,
    sourceHash: fingerprint(d.text),
    revision: "fixture-v1",
    applicability: d.effectivity!,
    authority: d.sourceAuthority!,
    trust: "raw-source" as const,
  }));
  await validateResearchEvidence(scope, evidence);
  await assert.rejects(
    () => validateResearchEvidence(subset, evidence),
    /access_denied/,
  );
  const recipe = await db.topicBuilderRecipe.create({
    data: {
      workspaceId: workspace.id,
      createdBy: context.userId,
      topic: "Fictional ALPHA-42",
      instructions: "",
      audience: "enthusiast",
      applicability: "Fixture",
      collectionIds: [bundle.id],
      maxWords: 180,
    },
  });
  const articles = [
    {
      id: "supply",
      title: "Fictional supply",
      answer: docs[0].text,
      evidenceIds: ["ev0"],
      keyPoints: [],
      details: [],
      relationships: [],
    },
    {
      id: "return",
      title: "Fictional return",
      answer: docs[1].text,
      evidenceIds: ["ev1"],
      keyPoints: [],
      details: [],
      relationships: [],
    },
  ];
  const run = await db.topicBuilderRun.create({
    data: {
      recipeId: recipe.id,
      workspaceId: workspace.id,
      createdBy: context.userId,
      status: "ready",
      fingerprint: scope.fingerprint,
      sourceManifest: json(docs.map((d) => ({ id: d.id }))),
      result: json({ articles, evidence, conflicts: [], excludedEvidence: [] }),
    },
  });
  await importBuilderRevision(run.id);
  await importBuilderRevision(run.id);
  const shared = await db.knowledgeArticle.findMany({
    where: {
      workspaceId: workspace.id,
      originId: { startsWith: `${recipe.id}:` },
    },
    include: { revisions: true },
  });
  assert.equal(shared.length, 2);
  assert.ok(shared.every((a) => a.revisions.length === 1));
  const revision = shared.find(
    (a) => (a.revisions[0].body as { id: string }).id === "supply",
  )!.revisions[0];
  assert.equal(
    (revision.evidence as unknown[]).length,
    1,
    "Unrelated evidence must not be attached to each article",
  );
  const visual = await addArticleVisual(context, {
    revisionId: revision.id,
    kind: "diagram",
    caption: "Fictional supply concept",
    altText: "The training supply feeds an actuator",
    spec: {
      title: "Fixture only",
      nodes: [
        { id: "supply", label: "Supply", x: 30, y: 70, evidenceIds: ["ev0"] },
        {
          id: "actuator",
          label: "Actuator",
          x: 330,
          y: 70,
          evidenceIds: ["ev0"],
        },
      ],
      edges: [
        {
          from: "supply",
          to: "actuator",
          label: "Feeds",
          evidenceIds: ["ev0"],
        },
      ],
    },
  });
  const provenance = visual.provenance as {
    objectKey: string;
    masterKey: string;
  };
  objects.push(provenance.objectKey, provenance.masterKey);
  assert.ok(provenance.masterKey);
  assert.ok(
    (await getObjectStorage().getObject(provenance.objectKey)).length > 100,
  );
  assert.equal(
    await db.knowledgeEfbSelection.count({
      where: {
        workspaceId: workspace.id,
        articleId: { in: shared.map((a) => a.id) },
      },
    }),
    0,
    "Drafts must never select themselves for EFB",
  );
  if(process.argv.includes("--diagram")){
    const proposed=await suggestArticleDiagram(context,revision.id);
    assert.equal(proposed.reviewedAt,null);
    const p=proposed.provenance as {objectKey:string;masterKey:string;generation:{model:string;policyVersion:string}};
    assert.ok(p.generation.model);assert.equal(p.generation.policyVersion,"evidence-diagram-v1");objects.push(p.objectKey,p.masterKey);
    console.log(JSON.stringify({diagramProposal:"passed",reviewRequired:true}));
  }
  if(process.argv.includes("--reuse")){
    const request={context,query:"Explain ALPHA-42 supply using the BLUE source. Read its original page.",consumer:"authoring" as const,documentIds:docs.map(d=>d.id),ownerId:`reuse-${suffix}`,reuseKey:`reuse-${suffix}`};
    const first=await runKnowledgeResearch(request);assert.ok(first.result.evidence.length);
    const second=await runKnowledgeResearch(request);assert.equal(second.result.toolCalls,0);assert.equal(second.result.modelSteps,0);assert.deepEqual(second.result.evidence,first.result.evidence);
    await db.knowledgeResearchRun.deleteMany({where:{ownerId:`reuse-${suffix}`}});
    console.log(JSON.stringify({evidenceReuse:"passed"}));
  }
  if(process.argv.includes("--media")){
    const svg=await getObjectStorage().getObject(provenance.masterKey);const svgPath=path.join(scratch,"source.svg"),pdfPath=path.join(scratch,"source.pdf");await writeFile(svgPath,svg);execFileSync("rsvg-convert",["--format","pdf","-o",pdfPath,svgPath]);const pdf=await readFile(pdfPath);const key=`verification/${suffix}/source.pdf`;await getObjectStorage().putObject({key,body:pdf,contentLength:pdf.length,contentType:"application/pdf"});objects.push(key);await db.documentObject.create({data:{workspaceId:workspace.id,documentId:docs[0].id,kind:"original_pdf",bucket:process.env.S3_BUCKET??"av-okf",objectKey:key,contentType:"application/pdf",sizeBytes:pdf.length}});
    const source=await addArticleVisual(context,{revisionId:revision.id,kind:"source",caption:"Source fixture annotation",altText:"A highlighted supply component",spec:{documentId:docs[0].id,page:1,x:0,y:0,width:1,height:1,annotations:[{label:"Supply",x:0.03,y:0.1,width:0.2,height:0.2,evidenceIds:["ev0"]}]}});objects.push((source.provenance as {objectKey:string}).objectKey);
    const revised=await addArticleVisual(context,{revisionId:revision.id,kind:"diagram",caption:"Revised fixture diagram",altText:"Supply component",replacesId:visual.id,spec:{title:"Edited fixture",nodes:[{id:"supply",label:"Supply",x:70,y:80,evidenceIds:["ev0"]}],edges:[]}});const revisedProvenance=revised.provenance as {objectKey:string;masterKey:string};objects.push(revisedProvenance.objectKey,revisedProvenance.masterKey);
    const allVisuals=await db.knowledgeVisual.findMany({where:{articleRevisionId:revision.id}});assert.equal(allVisuals.length,3);assert.equal(activeArticleVisuals(allVisuals).length,2);assert.ok(!activeArticleVisuals(allVisuals).some(v=>v.id===visual.id));
    await db.knowledgeArticleRevision.update({where:{id:revision.id},data:{approval:json({by:"verification-fixture",at:new Date().toISOString()})}});
    await assert.rejects(()=>addArticleVisual(context,{revisionId:revision.id,kind:"source",caption:"No change",altText:"No change",spec:{}}),/create_draft/);console.log(JSON.stringify({visualLifecycle:"passed",sourcePdfPreserved:true,annotatedDerivative:true,oldVisualRetained:true,approvedVisualsImmutable:true}));
  }
  if (process.argv.includes("--export")) {
    const keys = generateKeyPairSync("ed25519");
    const keyPath = path.join(scratch, "test-key.pem");
    await writeFile(
      keyPath,
      keys.privateKey.export({ type: "pkcs8", format: "pem" }),
      { mode: 0o600 },
    );
    process.env.AV_OKF_EFB_SIGNING_KEY_PATH = keyPath;
    process.env.AV_OKF_EFB_SIGNING_KEY_ID = "verification-only";
    process.env.AV_OKF_SOURCE_COMMIT = "a".repeat(40);
    process.env.AV_OKF_EFB_RELEASE_ROOT = path.join(scratch, "releases");
    for (const article of shared)
      await db.knowledgeArticleRevision.update({
        where: { id: article.revisions[0].id },
        data: {
          approval: json({
            by: "verification-fixture",
            at: new Date().toISOString(),
          }),
        },
      });
    await db.knowledgeVisual.update({
      where: { id: visual.id },
      data: { reviewedBy: "verification-fixture", reviewedAt: new Date() },
    });
    const selection = await db.knowledgeEfbSelection.create({
      data: {
        workspaceId: workspace.id,
        articleId: revision.articleId,
        revisionId: revision.id,
        createdBy: context.userId,
        metadata: json({
          aircraftTypeIds: ["b738"],
          aircraftFamily: "Boeing 737NG",
          effectivity: "737-800",
          audiences: ["maintenance"],
          placements: ["ata:29:0"],
          authority: "Fictional training reference � not approved instructions",
          license: "test-fixture-only",
          attribution: "Synthetic integration test",
        }),
      },
    });
    const releaseId = await exportSelectedArticles(context, [selection.id]);
    exportIds.push(releaseId);
    const release = await db.knowledgeExportRelease.findUniqueOrThrow({
      where: { id: releaseId },
    });
    const manifest = (
      release.result as { manifest: { entries: Array<{ id: string }> } }
    ).manifest;
    assert.deepEqual(
      manifest.entries.map((e) => e.id),
      [revision.articleId],
      "Only the selected approved article is exported",
    );
    console.log(
      JSON.stringify({
        selectedExport: "passed",
        selected: 1,
        unselectedApproved: 1,
      }),
    );
  }
  if (process.argv.includes("--live")) {
    const research = await runKnowledgeResearch({
      context,
      consumer: "chat",
      ownerId: `verification-${suffix}`,
      collectionIds: [bundle.id],
      query:
        "Enumerate both documents, then read page 1 of each. What are the ALPHA-42 supply and return paths and how do BLUE and RED selectors differ? Preserve both configurations.",
    });
    runIds.push(research.runId);
    assert.equal(
      new Set(research.result.evidence.map((e) => e.documentId)).size,
      2,
    );
    assert.equal(research.result.coverage, "retrieved");
    console.log(
      JSON.stringify({
        liveResearch: "passed",
        tools: research.result.toolCalls,
        steps: research.result.modelSteps,
      }),
    );
  }
  if (process.argv.includes("--eval")) {
    for (const item of researchEvaluationCases) {
      const started = Date.now();
      const baseline = await retrieveDocuments({
        workspaceId: workspace.id,
        documentIds: docs.map((d) => d.id),
        mode: "hybrid",
        query: item.question,
        topK: 10,
      });
      const baselineMs = Date.now() - started;
      const at = Date.now();
      const researched = await runKnowledgeResearch({
        context,
        consumer: "chat",
        ownerId: `verification-${suffix}`,
        collectionIds: [bundle.id],
        query: item.question,
      });
      const found = new Set(
        researched.result.evidence.map((e) => e.documentId),
      );
      const missed = item.critical.filter((i) => !found.has(docs[i].id));
      assert.ok(
        researched.result.evidence.every((e) =>
          docs.some((d) => d.id === e.documentId),
        ),
        "Scope leakage",
      );
      console.log(
        JSON.stringify({
          case: item.id,
          graphMs: Date.now() - at,
          baselineMs,
          baselineDocuments: new Set(baseline.map((h) => h.documentId)).size,
          fullScanDocuments: docs.length,
          graphDocuments: found.size,
          criticalMisses: missed.length,
          tools: researched.result.toolCalls,
          steps: researched.result.modelSteps,
        }),
      );
      assert.equal(missed.length, 0, `Critical evidence missing: ${item.id}`);
    }
  }
  if(process.argv.includes("--bulk")){
    const existing=await db.knowledgeBundle.findFirstOrThrow({where:{workspaceId:workspace.id,activeProfileVersionId:{not:null}},include:{activeProfileVersion:true}});
    const profile=await db.knowledgeBundleProfileVersion.create({data:{bundleId:bundle.id,version:1,status:"active",templateId:existing.activeProfileVersion!.templateId,schema:existing.activeProfileVersion!.schema as Prisma.InputJsonValue,createdBy:context.userId,activatedAt:new Date()}});
    await db.knowledgeBundle.update({where:{id:bundle.id},data:{activeProfileVersionId:profile.id}});
    const topic=await db.topicRecord.create({data:{workspaceId:workspace.id,knowledgeBundleId:bundle.id,documentId:docs[0].id,originalTitle:"Fictional ALPHA supply",originalSummary:docs[0].text,title:"Fictional ALPHA supply",summary:docs[0].text,topicType:"system_topic",pageStart:1,pageEnd:1,sourcePageNumbers:[1],confidence:"high",reviewStatus:"needs_review"}});
    await assert.rejects(()=>queueSelectedTopicEnrichment(context,"not-this-bundle",[topic.id]));
    assert.equal(await queueSelectedTopicEnrichment(context,bundle.id,[topic.id,topic.id]),1);
    let completed=false;for(let i=0;i<150;i++){const t=await db.topicRecord.findUniqueOrThrow({where:{id:topic.id}});if(t.enrichmentStatus==="completed"){assert.ok(t.enrichedTitle&&t.enrichedSummary&&t.enrichedBody);assert.notEqual(t.reviewStatus,"approved");assert.equal(t.exportedFilePath,null);completed=true;break;}await new Promise(r=>setTimeout(r,1000));}assert.ok(completed,"Bulk worker did not produce a draft");
    console.log(JSON.stringify({bulkEnrichment:"passed",deduplicated:true,scopeChecked:true,approved:false,exported:false}));
  }
  if (process.argv.includes("--graph")) {
    const topics = [];
    for (let i = 0; i < docs.length; i++)
      topics.push(
        await db.topicRecord.create({
          data: {
            workspaceId: workspace.id,
            knowledgeBundleId: bundle.id,
            documentId: docs[i].id,
            originalTitle: docs[i].title,
            originalSummary: docs[i].text,
            title: docs[i].title,
            summary: docs[i].text,
            topicType: "system_topic",
            pageStart: 1,
            pageEnd: 1,
            sourcePageNumbers: [1],
            confidence: "high",
            reviewStatus: "needs_review",
            exportedFilePath: `topics/${i === 0 ? "supply" : "return"}.md`,
            relations: json(
              i === 0 ? [{ relation: "related_to", target: "return.md" }] : [],
            ),
          },
        }),
      );
    await db.entityRelationCandidate.create({
      data: {
        workspaceId: workspace.id,
        knowledgeBundleId: bundle.id,
        documentId: docs[0].id,
        sourceTopicId: topics[0].id,
        targetTopicId: topics[1].id,
        relation: "related_to",
        evidenceQuote: docs[0].text,
        evidenceChunkIds: [],
        evidencePageNumbers: [1],
        contentHash: fingerprint(docs[0].text),
        status: "candidate",
      },
    });
    const graph = await runKnowledgeResearch({
      context,
      consumer: "chat",
      ownerId: `verification-${suffix}`,
      collectionIds: [bundle.id],
      query: `First call follow_links on topic ${topics[0].id}, then read both original source pages to compare the supply and return paths. Treat candidate relations as discovery only.`,
    });
    assert.equal(
      new Set(graph.result.evidence.map((e) => e.documentId)).size,
      2,
    );
    const trace = await db.knowledgeResearchRun.findUniqueOrThrow({
      where: { id: graph.runId },
    });
    assert.ok(
      (
        trace.diagnostics as { toolEvents: Array<{ name: string }> }
      ).toolEvents.some((e) => e.name === "Checking related knowledge"),
    );
    const narrowed = await runKnowledgeResearch({
      context,
      consumer: "chat",
      ownerId: `verification-${suffix}`,
      documentIds: [docs[0].id],
      query: `Follow links from topic ${topics[0].id}. Read any available related evidence but do not infer inaccessible content.`,
    });
    assert.ok(
      narrowed.result.evidence.every((e) => e.documentId === docs[0].id),
    );
    console.log(
      JSON.stringify({
        graphTraversal: "passed",
        candidateAndNativeLinks: true,
        narrowedScopeSafe: true,
      }),
    );
  }
  if(process.argv.includes("--chat")){
    process.env.AV_OKF_CHAT_ENABLED="true";process.env.AV_OKF_SHARED_ENABLED="true";
    const existing=await db.knowledgeBundle.findFirstOrThrow({where:{workspaceId:workspace.id,status:"active",activeProfileVersionId:{not:null},id:{not:bundle.id}},include:{activeProfileVersion:true}});
    const base=await getKnowledgeBundleByIdentity({workspaceId:workspace.id,bundleId:existing.id});if(!base)throw Error("Missing profile fixture");
    const profile=await db.knowledgeBundleProfileVersion.create({data:{bundleId:bundle.id,version:1,status:"active",templateId:existing.activeProfileVersion!.templateId,schema:json(base.profile),createdBy:context.userId,activatedAt:new Date()}});await db.knowledgeBundle.update({where:{id:bundle.id},data:{activeProfileVersionId:profile.id}});await scaffoldKnowledgeBundle({workspaceId:workspace.id,bundleId:bundle.id,profile:base.profile});fixtureRoot=resolveKnowledgeBundleRoot({workspaceId:workspace.id,bundleId:bundle.id});
    const service=createProductionChatService(undefined,{getContext:async()=>context});const session=await service.createSession(bundle.id,"Shared workflow verification");chatIds.push(session.id);assert.ok(session.knowledgeBundles.some(b=>b.id===bundle.id));
    await service.updateSessionKnowledgeBundles(session.id,[bundle.id]);const greeting=await service.sendMessage(session.id,"hi");assert.match(greeting.assistantMessage.content,/Hi!/);assert.equal(greeting.assistantMessage.trace?.responseKind,"conversation");
    const answered=await service.sendMessage(session.id,"Search the raw training documents and explain the ALPHA-42 supply and return paths, keeping BLUE and RED configurations separate.");assert.ok(answered.assistantMessage.citations.length>0);assert.ok(answered.assistantMessage.citations.every(c=>docs.some(d=>d.id===c.documentId)));console.log(JSON.stringify({chatAnswer:answered.assistantMessage.content,citations:answered.assistantMessage.citations.length}));
    const other=await db.knowledgeBundle.findFirstOrThrow({where:{workspaceId:workspace.id,status:"active",id:{not:bundle.id}}});
    const pending=service.sendMessage(session.id,"Search both raw documents again and compare the BLUE mechanical selector and RED electrical selector.").then(value=>({value}),error=>({error}));let running=false;for(let i=0;i<500;i++){if(await db.knowledgeResearchRun.count({where:{ownerId:session.id,status:"running"}})){running=true;break;}await new Promise(r=>setTimeout(r,50));}assert.ok(running,"No cancellable research run started");await service.updateSessionKnowledgeBundles(session.id,[other.id]);const stopped=await pending;assert.ok("error" in stopped,"Changed scope must prevent the answer from committing");assert.equal(await db.chatMessage.count({where:{sessionId:session.id}}),4);console.log(JSON.stringify({chatLifecycle:"passed",greeting:true,citedAnswer:true,scopeChangeCancelled:true}));
    await service.updateSessionKnowledgeBundles(session.id,[bundle.id]);
    const withdrawnPending=service.sendMessage(session.id,"Search the raw documents for ALPHA-42 supply and return and explain the configuration differences.").then(value=>({value}),error=>({error}));
    let withdrawalRun=false;for(let i=0;i<500;i++){if(await db.knowledgeResearchRun.count({where:{ownerId:session.id,status:"running"}})){withdrawalRun=true;break;}await new Promise(r=>setTimeout(r,50));}assert.ok(withdrawalRun);
    await db.document.update({where:{id:docs[0].id},data:{deletedAt:new Date()}});
    const withdrawn=await withdrawnPending;assert.ok("error" in withdrawn,"Source removal during generation must invalidate output");assert.equal(await db.chatMessage.count({where:{sessionId:session.id}}),4);
    await db.document.update({where:{id:docs[0].id},data:{deletedAt:null}});
    console.log(JSON.stringify({withdrawalDuringChat:"passed"}));
  }
  if (process.argv.includes("--briefs")) {
    process.env.AV_OKF_AUTHORING_ENABLED = "true";
    process.env.AV_OKF_SHARED_ENABLED = "true";
    for (const brief of articleEvaluationBriefs)
      for (const mode of ["agentic", "exhaustive"]) {
        const recipe = await db.topicBuilderRecipe.create({
          data: {
            workspaceId: workspace.id,
            createdBy: context.userId,
            topic: brief,
            instructions:
              "Write as an instructor for an enthusiast. Use only these fictional training sources. Preserve BLUE and RED distinctions; do not invent operating parameters.",
            audience: "enthusiast",
            applicability: "Fictional ALPHA-42",
            collectionIds: [bundle.id],
            maxWords: 180,
            researchMode: mode,
          },
        });
        const corpus = await getBuilderCorpus(workspace.id, [bundle.id]);
        const build = await db.topicBuilderRun.create({
          data: {
            recipeId: recipe.id,
            workspaceId: workspace.id,
            createdBy: context.userId,
            fingerprint: corpus.fingerprint,
            sourceManifest: json(corpus.manifest),
          },
        });
        runIds.push(build.id);
        const at = Date.now();
        await runTopicBuilder(build.id);
        const finished = await db.topicBuilderRun.findUniqueOrThrow({
          where: { id: build.id },
        });
        assert.equal(
          finished.status,
          "ready",
          finished.error ?? "Authoring failed",
        );
        console.log(
          JSON.stringify({
            brief,
            mode,
            ms: Date.now() - at,
            result: finished.result,
          }),
        );
      }
  }
  await db.extractedPage.updateMany({
    where: { documentId: docs[0].id },
    data: { text: "Changed source passage" },
  });
  await assert.rejects(
    () => validateResearchEvidence(scope, evidence),
    /evidence_unavailable/,
  );
  await assert.rejects(
    () => assertArticleSourcesCurrent(context, revision.id),
    /sources_changed/,
  );
  await db.document.update({
    where: { id: docs[0].id },
    data: { deletedAt: new Date() },
  });
  await assert.rejects(
    () => validateKnowledgeScope(scope),
    /source_unavailable/,
  );
  console.log(
    JSON.stringify({
      result: "passed",
      checks: [
        "membership denial",
        "scope isolation",
        "exact evidence validation",
        "idempotent backfill",
        "article-specific evidence",
        "controlled diagram PNG and SVG master",
        "no implicit EFB selection",
        "source edit invalidation",
        "withdrawal invalidation",
      ],
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "verification_failed");
  throw error;
} finally {
  const articles = await db.knowledgeArticle.findMany({
    where: { workspaceId: workspace.id, collectionId: bundle.id },
  });
  const revisions = await db.knowledgeArticleRevision.findMany({
    where: { articleId: { in: articles.map((a) => a.id) } },
  });
  await db.knowledgeEfbSelection.deleteMany({
    where: { articleId: { in: articles.map((a) => a.id) } },
  });
  await db.knowledgeExportRelease.deleteMany({
    where: { id: { in: exportIds } },
  });
  await db.knowledgeVisual.deleteMany({
    where: { articleRevisionId: { in: revisions.map((r) => r.id) } },
  });
  await db.knowledgeArticleRevision.deleteMany({
    where: { id: { in: revisions.map((r) => r.id) } },
  });
  await db.knowledgeArticle.deleteMany({
    where: { id: { in: articles.map((a) => a.id) } },
  });
  for (const key of objects.filter(Boolean))
    await getObjectStorage().deleteObject(key);
  await db.knowledgeResearchRun.deleteMany({
    where: {
      workspaceId: workspace.id,
      OR: [{ ownerId: `verification-${suffix}` }, { ownerId: { in: runIds } }],
    },
  });
  await db.topicBuilderRecipe.deleteMany({
    where: { workspaceId: workspace.id, collectionIds: { has: bundle.id } },
  });
  await db.document.deleteMany({ where: { knowledgeBundleId: bundle.id } });
  await db.knowledgeBundle.delete({ where: { id: bundle.id } });
  await rm(scratch, { recursive: true, force: true });
  await db.knowledgeResearchRun.deleteMany({where:{ownerId:{in:chatIds},workspaceId:workspace.id}});await db.chatSession.deleteMany({where:{id:{in:chatIds}}});
  if(fixtureRoot&&path.basename(fixtureRoot)===bundle.id)await rm(fixtureRoot,{recursive:true,force:true});
  await db.$disconnect();
}
