import { getPipeline } from '../../../../../../lib/server/pipelineStore';
import { safeFetch, BlockedUrl } from '../../../../../../lib/server/safeFetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Download a cast member's image with the USER'S name (slug) as the filename.
 *  Server-side fetch because cross-origin OSS urls ignore the client `download` attribute.
 *  The url comes from the project document, but PUT /api/pipeline/[id] takes that document from
 *  the client unauthenticated, so it is caller-controlled: it goes through safeFetch or this
 *  route proxies reads of anything the instance can reach. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; assetId: string }> }): Promise<Response> {
  const { id, assetId } = await params;
  const doc = getPipeline(id);
  const asset = doc.assets.find((a) => a.id === assetId);
  if (!asset?.imageUrl) return Response.json({ error: 'no image for this asset' }, { status: 404 });

  let bytes: ArrayBuffer;
  let type = 'image/png';
  if (asset.imageUrl.startsWith('data:')) {
    const [head, b64] = asset.imageUrl.split(',');
    type = head?.match(/data:([^;]+)/)?.[1] ?? type;
    bytes = Buffer.from(b64 ?? '', 'base64').buffer as ArrayBuffer;
  } else {
    let res: Response;
    try {
      res = await safeFetch(asset.imageUrl);
    } catch (e) {
      if (e instanceof BlockedUrl) return Response.json({ error: e.reason }, { status: 400 });
      throw e;
    }
    if (!res.ok) return Response.json({ error: `source fetch ${res.status}` }, { status: 502 });
    type = res.headers.get('content-type')?.split(';')[0] ?? type;
    bytes = await res.arrayBuffer();
  }
  const filename = `${asset.slug || 'asset'}.${EXT[type] ?? 'png'}`;
  return new Response(bytes, {
    headers: {
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
