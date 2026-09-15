export type DocumentUploadSessionDescriptor = {
  documentId: string;
  expiresAt: string;
  filename: string;
  requiredHeaders: Record<string, string>;
  sessionId: string;
  uploadUrl: string;
};
