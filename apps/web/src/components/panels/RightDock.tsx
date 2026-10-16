'use client';
import { useT } from '@/lib/editor';
import { useUi, type RightTab } from '@/lib/store';
import { usePrefs } from '@/lib/prefs';
import type { MsgKey } from '@/lib/i18n';
import { Properties } from './Properties';
import { Comments } from './Comments';
import { Review } from './Review';
import { AiPanel } from './AiPanel';
import { MeetingPanel } from './MeetingPanel';
import { History } from './History';

export function RightDock() {
  const t = useT();
  const open = useUi((s) => s.rightOpen);
  const tab = useUi((s) => s.rightTab);
  const advanced = usePrefs((s) => s.mode) === 'advanced';
  const tabs: [RightTab, MsgKey][] = [
    ['properties', advanced ? 'dock.properties' : 'studio.edit'],
    ['comments', 'dock.comments'],
    ['review', 'dock.review'],
    ['ai', 'dock.ai'],
    ['meeting', 'dock.meeting'],
    ['history', 'dock.history'],
  ];
  return (
    <aside className={`dock right float-panel ${open ? 'open' : 'closed'}`} aria-label="Right dock">
      <div className="dock-tabs" role="tablist">
        {tabs.filter(([k]) => advanced || !['meeting', 'history'].includes(k) || k === tab).map(([k, label]) => (
          <button key={k} role="tab" className="dock-tab" aria-selected={tab === k} onClick={() => useUi.setState({ rightTab: k, rightOpen: true })} title={t(label)} data-testid={`tab-${k}`}>
            {open ? t(label) : t(label)[0]}
          </button>
        ))}
        <span className="spacer" />
        <button className="dock-tab" onClick={() => useUi.setState({ rightOpen: !open })} aria-label={open ? t('dock.collapse') : t('dock.expand')}>
          {open ? '⟩' : '⟨'}
        </button>
      </div>
      {open && (
        <div className="dock-body">
          {/* AI panel stays mounted so the top-bar button can start a run from any tab. */}
          <div style={{ display: tab === 'ai' ? 'block' : 'none' }}>
            <AiPanel />
          </div>
          {tab === 'properties' && <Properties />}
          {tab === 'comments' && <Comments />}
          {tab === 'review' && <Review />}
          {tab === 'meeting' && <MeetingPanel />}
          {tab === 'history' && <History />}
        </div>
      )}
    </aside>
  );
}
