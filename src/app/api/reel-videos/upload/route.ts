import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { apiViewer } from "@/lib/auth";
import { REEL_VIDEO_MAX_BYTES, REEL_VIDEO_TYPES, reelVideoKeyOwner } from "@/lib/engine/reel-listen";
import { UploadRefusal, redactUrls } from "@/lib/engine/storage-policy";
import { PROOF_STORAGE_UNCONFIGURED, proofStorageConfigured, proofTokenOptions } from "@/lib/proof-storage";
import { videoRoom } from "@/lib/reel-videos";

/**
 * Reel to Post, PR B (H-1948, plan H-1953): the token for a browser-to-bucket upload of a reel video into the PRIVATE store,
 * the same store and the same way as a proof's files. The bytes never pass through a function here, and the video is only
 * uploaded when the member attaches it to the post: listening to it runs on their device. The door enforces: the key is
 * under reels/<their workspace>/<their own folder>/, the type is MP4 or QuickTime (sniffed again before anything is
 * recorded), the size is under 200 MB, and the member has room for one more.
 */
export async function POST(request: Request) {
  const v = await apiViewer();
  if (!v) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (v.switchedInto?.mode === "view") return NextResponse.json({ error: `You're viewing ${v.switchedInto.clientName.split(" ")[0]}'s HelixOS. Switch to Work to add files.` }, { status: 403 });
  if (!proofStorageConfigured()) {
    console.error("[reel-videos] PROOF_BLOB_READ_WRITE_TOKEN is not set: an upload token was refused");
    return NextResponse.json({ error: PROOF_STORAGE_UNCONFIGURED }, { status: 503 });
  }
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      ...proofTokenOptions(),
      onBeforeGenerateToken: async (pathname) => {
        const owner = reelVideoKeyOwner(pathname);
        if (!owner || owner.workspaceId !== v.workspace.id || owner.userId !== v.user.id) throw new UploadRefusal("A reel video goes under your own folder and nowhere else.");
        const full = await videoRoom(v.workspace.id, v.user.id);
        if (full) throw new UploadRefusal(full);
        return {
          allowedContentTypes: REEL_VIDEO_TYPES.map((t) => t.mime),
          maximumSizeInBytes: REEL_VIDEO_MAX_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
        };
      },
      // No completion callback: the page records the upload through recordReelVideoAction, which reads it back and sniffs it first.
    });
    return NextResponse.json(json);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[reel-videos] upload token refused", redactUrls(JSON.stringify({ message: message.slice(0, 300) })));
    return NextResponse.json({ error: e instanceof UploadRefusal ? e.message : "The upload was refused. Try again in a minute." }, { status: 400 });
  }
}
