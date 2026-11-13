// Leave room for multipart headers below the hosted Function request limit.
export const OPERATIONAL_PROOF_UPLOAD_MAX_BYTES = 3.5 * 1024 * 1024;
export const OPERATIONAL_PROOF_REQUEST_MAX_BYTES = OPERATIONAL_PROOF_UPLOAD_MAX_BYTES + 64 * 1024;
export const OPERATIONAL_PROOF_OPTIMIZED_FILE_BYTES = 600 * 1024;
export const OPERATIONAL_PROOF_MAX_EDGE = 2048;
export const OPERATIONAL_PROOF_MAX_PIXELS = 30_000_000;

export class OperationalProofUploadError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); this.name = "OperationalProofUploadError"; }
}
