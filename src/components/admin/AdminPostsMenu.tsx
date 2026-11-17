import { useEffect, useId, useState } from 'react';
import { ChevronDown, FileText, Plus, Folder, Tags, MessageSquare, Image, Settings, Trash2 } from 'lucide-react';
import { ADMIN_POST_PAGES, adminPostPage, type AdminPostTab } from '../../utils/adminPostsNavigation';

const icons = { list: FileText, write: Plus, categories: Folder, tags: Tags, comments: MessageSquare, media: Image, settings: Settings, trash: Trash2 };

export function AdminPostsMenu({ currentTab, onSelect, mobile = false, collapsed = false }: {
  currentTab: string;
  onSelect: (tab: AdminPostTab) => void;
  mobile?: boolean;
  collapsed?: boolean;
}) {
  const active = Boolean(adminPostPage(currentTab));
  const [open, setOpen] = useState(active);
  const submenuId = useId();
  useEffect(() => { if (active) setOpen(true); }, [active, currentTab]);

  return <div className="pt-0.5">
    <button type="button" aria-expanded={collapsed || open} aria-controls={submenuId} onClick={() => {
      if (collapsed && window.matchMedia('(min-width: 1024px)').matches) onSelect(ADMIN_POST_PAGES[0].tab);
      else setOpen(value => !value);
    }}
      title={collapsed ? 'نوشته‌ها' : undefined}
      className={`w-full flex items-center justify-between px-3 rounded-xl text-xs font-bold transition-colors ${collapsed ? 'lg:justify-center lg:px-0' : ''} ${mobile ? 'py-3 min-h-[44px]' : 'py-2 min-h-[38px]'} ${active ? 'bg-gradient-to-r from-sky-50 to-emerald-50 text-sky-800 border border-sky-200' : 'text-slate-600 hover:bg-slate-100'}`}>
      <span className={`flex items-center gap-2.5 ${collapsed ? 'lg:justify-center lg:gap-0' : ''}`}><FileText className="w-4 h-4" /><span className={collapsed ? 'lg:hidden' : ''}>نوشته‌ها</span></span>
      <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${collapsed ? 'lg:hidden' : ''} ${open ? 'rotate-180' : ''}`} />
    </button>
    <div id={submenuId} className={`mt-0.5 space-y-0.5 ${!open ? (collapsed ? 'hidden lg:block' : 'hidden') : ''} ${collapsed ? 'pr-3 lg:pr-0' : 'pr-3'}`} aria-label="زیرمنوی نوشته‌ها">
      {ADMIN_POST_PAGES.map(page => {
        const Icon = icons[page.section];
        const selected = currentTab === page.tab;
        return <button type="button" key={page.tab} aria-current={selected ? 'page' : undefined} onClick={() => onSelect(page.tab)}
          title={collapsed ? page.label : undefined}
          className={`w-full flex items-center gap-2 px-2.5 rounded-lg text-[11px] font-bold border-r-2 transition-colors ${collapsed ? 'lg:justify-center lg:px-0 lg:border-r-0' : ''} ${mobile ? 'py-2 min-h-[44px]' : 'py-1.5 min-h-[32px]'} ${selected ? 'text-sky-800 bg-sky-50 border-sky-500' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100 border-transparent'}`}>
          <Icon className="w-3.5 h-3.5 flex-shrink-0" /><span className={`truncate ${collapsed ? 'lg:hidden' : ''}`}>{page.label}</span>
        </button>;
      })}
    </div>
  </div>;
}
