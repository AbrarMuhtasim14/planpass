import { Files } from "files-sdk";
import { neon as neonAdapter } from "files-sdk/neon";

export const BUCKET = "assets";

// files-sdk neon adapter resolves endpoint/credentials from injected AWS_*
// env vars (see neon-object-storage skill). No template-writing marker.
export const files = new Files({ adapter: neonAdapter({ bucket: BUCKET }) });

export async function uploadPlanBytes(
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  await files.upload(key, bytes, { contentType });
}

export async function downloadPlanBytes(key: string): Promise<Uint8Array> {
  const file = await files.download(key);
  return new Uint8Array(await file.arrayBuffer());
}

export async function planPresignedUrl(key: string): Promise<string> {
  // Private bucket -> presigned GET (1h default)
  return files.url(key, { expiresIn: 3600 });
}

export const putObject = uploadPlanBytes;
export const getObjectBytes = downloadPlanBytes;
export const objectUrl = planPresignedUrl;
export const redlineKeyFor = (inspectionId: string) => `redlines/${inspectionId}.png`;
export const revisedKeyFor = (inspectionId: string) => `revised/${inspectionId}.png`;

export async function listPlanKeys(prefix: string): Promise<string[]> {
  const out: string[] = [];
  const result = await files.list({ prefix });
  for (const item of result as unknown as Array<{ key?: string; name?: string }>) {
    if (item.key) out.push(item.key);
    else if (item.name) out.push(item.name);
  }
  return out;
}
