import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getViewer } from "@/lib/auth";
import { ACCEPTED, VIDEO_MAX_BYTES, proofKeyWorkspace } from "@/lib/engine/proof-attachments";
import { UploadRefusal, redactUrls } from "@/lib/engine/storage-policy";
import { admissionFor } from "@/lib/queries/proof-attachments";
import { PROOF_STORAGE_UNCONFIGURED, proofStorageConfigured, proofTokenOptions } from "@/lib/proof-storage";

/**
 * The token for a browser-to-bucket upload into the PRIVATE proof store. The bytes never pass through a function here. The
 * token is minted from the proof store's own token, explicitly (proofTokenOptions), never from the ambient one the public
 * lead-magnet store owns. The door enforces: the proof is the signed-in client's, the key is under proofs/<their
 * workspace>/<that proof>/, the type is one a proof may carry (the bytes are sniffed again after the upload, before anything
 * is recorded), the size is under the largest cap (the kind's own cap applies after sniffing), the proof has room for one more,
 * and the workspace has room in its quota.
 */
export async function POST(request: Request) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!proofStorageConfigured()) {
    console.error("[proof-storage] PROOF_BLOB_READ_WRITE_TOKEN is not set: an upload token was refused");
    return NextResponse.json({ error: PROOF_STORAGE_UNCONFIGURED }, { status: 503 });
  }
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      ...proofTokenOptions(),
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload = JSON.parse(clientPayload ?? "{}") as { proofId?: string; size?: number };
        const proof = await db.query.proofs.findFirst({ where: and(eq(schema.proofs.id, payload.proofId ?? ""), eq(schema.proofs.workspaceId, v.workspace.id), eq(schema.proofs.userId, v.user.id)) });
        if (!proof) throw new UploadRefusal("That proof is not yours.");
        if (proofKeyWorkspace(pathname) !== v.workspace.id || !pathname.startsWith(`proofs/${v.workspace.id}/${proof.id}/`) || /-display\.jpg$/.test(pathname)) throw new UploadRefusal("A proof's file goes under the proof's own folder and nowhere else.");
        // The browser's size is a claim; the store's size is checked again when the upload is recorded.
        const refused = await admissionFor(v.workspace.id, proof.id, Number.isFinite(payload.size) && Number(payload.size) > 0 ? Number(payload.size) : 0);
        if (refused) throw new UploadRefusal(refused);
        return {
          allowedContentTypes: [...new Set(ACCEPTED.map((a) => a.mime)), "image/heif"],
          maximumSizeInBytes: VIDEO_MAX_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
          tokenPayload: JSON.stringify({ proofId: proof.id }),
        };
      },
      // No completion callback: the browser records the upload through recordProofAttachmentAction, which reads the object
      // back from the store and sniffs its bytes first, and an upload that is never recorded is reconciled away above.
    });
    return NextResponse.json(json);
  } catch (e) {
    // Only a refusal this door wrote reaches the screen; anything else is the SDK's and is logged, not shown.
    const message = e instanceof Error ? e.message : String(e);
    console.error("[proof-storage] upload token refused", redactUrls(JSON.stringify({ message: message.slice(0, 300) })));
    return NextResponse.json({ error: e instanceof UploadRefusal ? e.message : "The upload was refused. Try again in a minute." }, { status: 400 });
  }
}
