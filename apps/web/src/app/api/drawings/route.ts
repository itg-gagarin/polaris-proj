import { parseDxf, DxfError } from '@bom/bom-io/dxf';
import { route, body, HttpError } from '@/server/http';
import { requireSession } from '@/server/auth';

/** Hosted functions accept ~4.5 MB bodies; base64 adds a third, so 3 MB of file. */
const MAX = 3 * 1024 * 1024;
const IMAGES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

/**
 * Store a detail drawing (AutoCAD DXF or an image) and return its reference; the client attaches it
 * to parts with a patch (field "drawing"), so it is versioned with the revision like any other edit.
 */
export const POST = route(async (req) => {
  const { user, repo } = await requireSession(req);
  if (user.external || user.role === 'viewer') throw new HttpError(403, 'Viewers and external users cannot upload drawings');
  const b = await body<{ name?: string; data?: string }>(req);
  const name = (b.name ?? '').replace(/[^\w.\- ()]+/g, '_').slice(0, 120);
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (!b.data) throw new HttpError(400, 'No file data');
  const bytes = Uint8Array.from(Buffer.from(b.data, 'base64'));
  if (bytes.length > MAX) throw new HttpError(413, 'The file is larger than 3 MB. Save only the part’s drawing (or purge unused blocks) and try again.');
  if (ext === 'dwg') throw new HttpError(400, 'DWG cannot be read in the browser. In AutoCAD use Save As → DXF, then upload the .dxf.');
  let kind: 'dxf' | 'image';
  let mime: string;
  if (ext === 'dxf') {
    try {
      parseDxf(new TextDecoder('utf-8').decode(bytes));
    } catch (e) {
      throw new HttpError(400, e instanceof DxfError ? e.message : `Could not read the DXF: ${(e as Error).message}`);
    }
    kind = 'dxf';
    mime = 'application/dxf';
  } else if (IMAGES[ext]) {
    kind = 'image';
    mime = IMAGES[ext];
  } else throw new HttpError(400, 'Upload a .dxf (AutoCAD) or a .png / .jpg / .webp picture');
  const f = await repo.putFile(name, bytes, mime);
  return { drawing: { uri: f.uri, name: f.name, kind, mime, uploadedBy: user.id, uploadedAt: new Date().toISOString() } };
});
