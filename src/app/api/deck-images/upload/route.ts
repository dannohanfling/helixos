import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { DECK_IMAGE_MAX_BYTES, DECK_IMAGE_MIME, deckKeyOwner } from "@/lib/engine/deck-image";
import { UploadRefusal, redactUrls } from "@/lib/engine/storage-policy";
import { PROOF_STORAGE_UNCONFIGURED, proofStorageConfigured, proofTokenOptions } from "@/lib/proof-storage";

/**
 * The token for a browser-to-bucket upload of one deck image into the PRIVATE store, under deck/<workspace>/<user>/. The bytes
 * never pass through a function; the token is minted from the proof store's own token (proofTokenOptions), never the ambient
 * one the public lead-magnet store owns, so a coach's photo can never land at a URL anyone can open. The door enforces: the
 * uploader is signed in, the key is under their own deck folder, the type is an image the deck may carry, and the size is under
 * the cap. Consent, dimensions and the row come later, in recordDeckImageAction, after the bytes are read back and sniffed.
 */
export async function POST(request: Request) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!proofStorageConfigured()) {
    console.error("[deck-image] PROOF_BLOB_READ_WRITE_TOKEN is not set: an upload token was refused");
    return NextResponse.json({ error: PROOF_STORAGE_UNCONFIGURED }, { status: 503 });
  }
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      ...proofTokenOptions(),
      onBeforeGenerateToken: async (pathname) => {
        const owner = deckKeyOwner(pathname);
        if (!owner || owner.workspaceId !== v.workspace.id || owner.userId !== v.user.id) throw new UploadRefusal("A deck image goes under your own deck folder and nowhere else.");
        return {
          allowedContentTypes: [...DECK_IMAGE_MIME],
          maximumSizeInBytes: DECK_IMAGE_MAX_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
        };
      },
      // No completion callback: the browser records the upload through recordDeckImageAction, which reads the object back and
      // sniffs its bytes first; an upload that is never recorded is left in the store and does not become a row.
    });
    return NextResponse.json(json);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[deck-image] upload token refused", redactUrls(JSON.stringify({ message: message.slice(0, 300) })));
    return NextResponse.json({ error: e instanceof UploadRefusal ? e.message : "The upload was refused. Try again in a minute." }, { status: 400 });
  }
}
