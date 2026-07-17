import { getPipeline } from '../../../../../../lib/server/pipelineStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Download a cast member's image with the USER'S name (slug) as the filename.
 *  Server-side fetch because cross-origin OSS urls ignore the client `download` attribute.
 *  No arbitrary-url proxying: only urls already stored in this project's own document. */
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
    const res = await fetch(asset.imageUrl);
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
