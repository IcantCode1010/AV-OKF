import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

type DocumentObjectKeyInput = {
  documentId: string;
  objectId?: string;
  workspaceId: string;
};

export type ObjectStorage = {
  createPresignedPutUrl(input: {
    contentLength: number;
    contentType: string;
    expiresInSeconds: number;
    key: string;
  }): Promise<string>;
  deleteObject(key: string): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  getObjectRange(key: string, start: number, end: number): Promise<Buffer>;
  getObjectStream(key: string): Promise<Readable>;
  headObject(key: string): Promise<{ contentLength: number; contentType: string | null }>;
  listObjectKeys?(prefix: string): Promise<string[]>;
  putObject(input: {
    body: Buffer | Readable;
    contentLength?: number;
    contentType: string;
    key: string;
  }): Promise<void>;
};

type S3Config = {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  forcePathStyle: boolean;
  region: string;
  secretAccessKey: string;
};

let cachedStorage: ObjectStorage | null = null;

export function generateDocumentObjectId() {
  return randomUUID();
}

export function buildDocumentObjectKey(input: DocumentObjectKeyInput) {
  const objectId = input.objectId ?? generateDocumentObjectId();
  assertSafeSegment(input.workspaceId);
  assertSafeSegment(input.documentId);
  assertSafeSegment(objectId);

  return `workspaces/${input.workspaceId}/documents/${input.documentId}/original/${objectId}.pdf`;
}

export function createS3ObjectStorage(config = getS3ConfigFromEnv()): ObjectStorage {
  const client = new S3Client({
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    region: config.region,
  });

  return {
    async createPresignedPutUrl(input) {
      const publicClient = new S3Client({
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
        endpoint: process.env.S3_PUBLIC_ENDPOINT ?? config.endpoint,
        forcePathStyle: config.forcePathStyle,
        region: config.region,
      });
      return getSignedUrl(
        publicClient,
        new PutObjectCommand({
          Bucket: config.bucket,
          ContentLength: input.contentLength,
          ContentType: input.contentType,
          Key: input.key,
        }),
        { expiresIn: input.expiresInSeconds },
      );
    },
    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },
    async getObject(key) {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: key,
        }),
      );

      return streamToBuffer(response.Body);
    },
    async getObjectRange(key, start, end) {
      const response = await client.send(new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Range: `bytes=${start}-${end}`,
      }));
      return streamToBuffer(response.Body);
    },
    async getObjectStream(key) {
      const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
      return toReadable(response.Body);
    },
    async headObject(key) {
      const response = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
      return {
        contentLength: response.ContentLength ?? -1,
        contentType: response.ContentType ?? null,
      };
    },
    async listObjectKeys(prefix) {
      const keys: string[] = [];
      let continuationToken: string | undefined;
      do {
        const response = await client.send(new ListObjectsV2Command({
          Bucket: config.bucket,
          ContinuationToken: continuationToken,
          Prefix: prefix,
        }));
        keys.push(...(response.Contents ?? []).flatMap((entry) =>
          entry.Key ? [entry.Key] : [],
        ));
        continuationToken = response.IsTruncated
          ? response.NextContinuationToken
          : undefined;
      } while (continuationToken);
      return keys.sort();
    },
    async putObject(input) {
      await client.send(
        new PutObjectCommand({
          Body: input.body,
          Bucket: config.bucket,
          ContentLength: input.contentLength,
          ContentType: input.contentType,
          Key: input.key,
        }),
      );
    },
  };
}

export function getObjectStorage() {
  if (!cachedStorage) {
    cachedStorage = createS3ObjectStorage();
  }

  return cachedStorage;
}

function getS3ConfigFromEnv(): S3Config {
  return {
    accessKeyId: requiredEnv("S3_ACCESS_KEY_ID"),
    bucket: requiredEnv("S3_BUCKET"),
    endpoint: requiredEnv("S3_ENDPOINT"),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    region: process.env.S3_REGION ?? "us-east-1",
    secretAccessKey: requiredEnv("S3_SECRET_ACCESS_KEY"),
  };
}

function assertSafeSegment(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("unsafe_object_key_segment");
  }
}

function requiredEnv(key: string) {
  const value = process.env[key];

  if (!value) {
    throw new Error(`missing_env_${key}`);
  }

  return value;
}

async function streamToBuffer(body: unknown) {
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  if (body && typeof body === "object" && "transformToByteArray" in body) {
    const bytes = await (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }

  throw new Error("unsupported_s3_body");
}

function toReadable(body: unknown): Readable {
  if (body instanceof Readable) return body;
  if (body instanceof Uint8Array) return Readable.from(body);
  if (body && typeof body === "object" && "transformToWebStream" in body) {
    return Readable.fromWeb(
      (body as { transformToWebStream(): unknown }).transformToWebStream() as Parameters<typeof Readable.fromWeb>[0],
    );
  }
  throw new Error("unsupported_s3_body");
}
