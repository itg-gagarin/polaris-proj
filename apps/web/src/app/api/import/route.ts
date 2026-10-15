import { importFile } from '@bom/bom-io';
import { DictionaryIndex } from '@bom/dictionary';
import { route, HttpError } from '@/server/http';
import { requireSession } from '@/server/auth';

export const runtime = 'nodejs';

/**
 * Import preview (PRD §4). Runs in the request: the workbook (and its password, for encrypted
 * files) is never stored or queued, and costing columns are never read. Nothing is saved until
 * a person confirms the preview (POST /api/import/commit).
 */
export const POST = route(async (req) => {
  const { user, repo } = await requireSession(req);
  if (user.external || user.role === 'viewer' || user.role === 'reviewer') throw new HttpError(403, 'Only editors import products');
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'Attach an .xlsx or .csv file');
  if (file.size > 25 * 1024 * 1024) throw new HttpError(413, 'Workbooks over 25 MB are not supported');
  const password = (form.get('password') as string | null) || undefined;
  const dictionary = new DictionaryIndex(await repo.listStdParts());
  try {
    const res = await importFile(new Uint8Array(await file.arrayBuffer()), file.name, { dictionary, password });
    return res;
  } catch (e) {
    const msg = (e as Error).message;
    if (/password|encrypt|decrypt/i.test(msg)) throw new HttpError(422, password ? 'Wrong password for this workbook' : 'This workbook is password-protected: enter its password');
    throw new HttpError(422, `Could not read the workbook: ${msg}`);
  }
});
