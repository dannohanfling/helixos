import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getViewer } from "@/lib/auth";
import { UPLOAD_MAX_BYTES, UPLOAD_TYPES, publicFolderOf } from "@/lib/engine/storage-policy";
import { STORAGE_UNCONFIGURED, storageConfigured } from "@/lib/storage";

/**
 * The token for a browser-to-bucket upload: the bytes never pass through a function here. This is the public writer's
 * second door and it enforces the same rule: the pathname must be under public/magnets/<this magnet's slug>/, the magnet must
 * be the signed-in client's, the type must be one a magnet can be, and the size is capped. The upload is recorded by the
 * browser afterwards through recordMagnetUploadAction, which reads the object back from the bucket before trusting it.
 */
export async function POST(request: Request) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!storageConfigured()) {
    console.error("[storage] BLOB_READ_WRITE_TOKEN is not set: an upload token was refused");
    return NextResponse.json({ error: STORAGE_UNCONFIGURED }, { status: 503 });
  }
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const magnetId = (JSON.parse(clientPayload ?? "{}") as { magnetId?: string }).magnetId ?? "";
        const m = await db.query.leadMagnets.findFirst({ where: and(eq(schema.leadMagnets.id, magnetId), eq(schema.leadMagnets.userId, v.user.id)) });
        if (!m) throw new Error("That lead magnet is not yours.");
        if (publicFolderOf(pathname) !== m.slug) throw new Error("A magnet's file goes under the magnet's own folder and nowhere else.");
        return { allowedContentTypes: [...UPLOAD_TYPES], maximumSizeInBytes: UPLOAD_MAX_BYTES, addRandomSuffix: false, allowOverwrite: false, tokenPayload: JSON.stringify({ magnetId: m.id }) };
      },
      // Vercel's completion callback cannot reach a local server and may arrive late in production, so it records nothing:
      // the browser calls recordMagnetUploadAction once the bytes are in, and that reads the object back from the bucket.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(json);
  } catch (e) {
    // Our own refusals (not the client's magnet, the wrong folder) are plain sentences and pass through; anything else is the SDK's and is logged, not shown.
    const ours = e instanceof Error && /not yours|own folder/.test(e.message);
    console.error("[storage] upload token refused", JSON.stringify({ message: e instanceof Error ? e.message : String(e) }));
    return NextResponse.json({ error: ours ? (e as Error).message : "The upload was refused. Try again in a minute." }, { status: 400 });
  }
}
