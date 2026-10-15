import type { Finding, LayoutFamily, RevisionContent, Team, WorkspaceSettings, CheckThresholds } from '@bom/domain';
import type { ContentIndex } from '../model';
import type { Layout } from '../layout';
import type { ClashResult } from '../clash';

export interface CheckContext {
  content: RevisionContent;
  ix: ContentIndex;
  layout: Layout;
  params: Record<string, number>;
  settings: WorkspaceSettings;
  t: CheckThresholds;
  clashes: ClashResult[];
  resolveErrors: { target: string; partId?: string; message: string }[];
}

export interface CheckRule {
  id: string;
  title: string;
  team: Team;
  /** Families the rule applies to (default: all). */
  families?: LayoutFamily[];
  run(ctx: CheckContext): Finding[];
}
