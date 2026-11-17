import { useEffect, useId, useState } from 'react';
import { ChevronDown, FileText, Plus, Folder, Tags, MessageSquare, Image, Settings, Trash2 } from 'lucide-react';
import { ADMIN_POST_PAGES, adminPostPage, type AdminPostTab } from '../../utils/adminPostsNavigation';

const icons = { list: FileText, write: Plus, categories: Folder, tags: Tags, comments: MessageSquare, media: Image, settings: Settings, trash: Trash2 };

export function AdminPostsMenu({ currentTab, onSelect, mobile = false }: {
  currentTab: string;
  onSelect: (tab: AdminPostTab) => void;
  mobile?: boolean;
}) {
  const active = Boolean(adminPostPage(currentTab));
  const [open, setOpen] = useState(active);
  const submenuId = useId();
  useEffect(() => { if (active) setOpen(true); }, [active, currentTab]);

  return <div className="pt-0.5">
    <button type="button" aria-expanded={open} aria-controls={submenuId} onClick={() => setOpen(value => !value)}
      className={`w-full flex items-center justify-between px-3 rounded-xl text-xs font-bold transition-colors ${mobile ? 'py-3 min-h-[44px]' : 'py-2 min-h-[38px]'} ${active ? 'bg-gradient-to-r from-sky-50 to-emerald-50 text-sky-800 border border-sky-200' : 'text-slate-600 hover:bg-slate-100'}`}>
      <span className="flex items-center gap-2.5"><FileText className="w-4 h-4" />نوشته‌ها</span>
      <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    <div id={submenuId} hidden={!open} className="mt-0.5 space-y-0.5 pr-3" aria-label="زیرمنوی نوشته‌ها">
      {ADMIN_POST_PAGES.map(page => {
        const Icon = icons[page.section];
        const selected = currentTab === page.tab;
        return <button type="button" key={page.tab} aria-current={selected ? 'page' : undefined} onClick={() => onSelect(page.tab)}
          className={`w-full flex items-center gap-2 px-2.5 rounded-lg text-[11px] font-bold border-r-2 transition-colors ${mobile ? 'py-2 min-h-[44px]' : 'py-1.5 min-h-[32px]'} ${selected ? 'text-sky-800 bg-sky-50 border-sky-500' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100 border-transparent'}`}>
          <Icon className="w-3.5 h-3.5 flex-shrink-0" /><span className="truncate">{page.label}</span>
        </button>;
      })}
    </div>
  </div>;
}
