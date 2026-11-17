import { useEffect, useRef, useState } from 'react';
import { Bold, Italic, List, ListOrdered, Link, Image, Quote, Heading2, Undo2, Redo2 } from 'lucide-react';
import { safeBlogUrl, escapeHtml } from '../../utils/blogContent';
import type { BlogMedia } from '../../types/blog';

export function BlogEditor({ value, resetKey, onChange, media }: { value: string; resetKey: string; onChange: (html: string) => void; media: BlogMedia[] }) {
  const editor = useRef<HTMLDivElement>(null);
  const selection = useRef<Range | null>(null);
  const [link, setLink] = useState('');
  const [showInsert, setShowInsert] = useState(false);
  useEffect(() => { if (editor.current) editor.current.innerHTML = value; document.execCommand('defaultParagraphSeparator', false, 'p'); }, [resetKey]);
  const remember = () => { const selected = window.getSelection(); if (selected?.rangeCount && editor.current?.contains(selected.anchorNode)) selection.current = selected.getRangeAt(0).cloneRange(); };
  const command = (name: string, argument?: string) => {
    editor.current?.focus(); const selected = window.getSelection();
    if (selection.current && selected) { try { selected.removeAllRanges(); selected.addRange(selection.current); } catch { selection.current = null; } }
    document.execCommand(name, false, argument); remember(); onChange(editor.current?.innerHTML || '');
  };
  const tools = [
    ['bold', 'پررنگ', Bold], ['italic', 'مورب', Italic], ['insertUnorderedList', 'فهرست نقطه‌ای', List], ['insertOrderedList', 'فهرست شماره‌دار', ListOrdered],
    ['formatBlock', 'عنوان بخش', Heading2], ['blockquote', 'نقل‌قول', Quote], ['undo', 'واگرد', Undo2], ['redo', 'بازگرد', Redo2]
  ] as const;
  return <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
    <div role="toolbar" aria-label="قالب‌بندی نوشته" className="flex flex-wrap items-center gap-1 p-2 border-b border-slate-200 bg-slate-50">
      {tools.map(([cmd, label, Icon]) => <button key={cmd} type="button" aria-label={label} title={label} onMouseDown={event => event.preventDefault()}
        onClick={() => command(cmd === 'blockquote' ? 'formatBlock' : cmd, cmd === 'formatBlock' ? 'h2' : cmd === 'blockquote' ? 'blockquote' : undefined)}
        className="p-2 rounded-lg hover:bg-sky-100 focus-visible:ring-2 focus-visible:ring-sky-500"><Icon className="w-4 h-4" /></button>)}
      <button type="button" onClick={() => setShowInsert(!showInsert)} aria-expanded={showInsert} className="flex gap-2 items-center px-3 py-2 text-xs rounded-lg hover:bg-sky-100"><Link className="w-4 h-4" /><Image className="w-4 h-4" />پیوند و تصویر</button>
    </div>
    {showInsert && <div className="p-3 border-b border-slate-200 space-y-3">
      <div className="flex flex-wrap gap-2"><label className="flex-1 text-xs">آدرس پیوند<input value={link} onChange={e => setLink(e.target.value)} dir="ltr" placeholder="https://…" className="w-full mt-1 p-2 border rounded-lg" /></label>
        <button type="button" className="self-end px-3 py-2 bg-sky-50 text-sky-700 rounded-lg text-xs" disabled={!safeBlogUrl(link)} onClick={() => command('createLink', safeBlogUrl(link))}>درج پیوند</button></div>
      <label className="block text-xs">درج تصویر از رسانه‌ها<select className="w-full mt-1 p-2 border rounded-lg" value="" onChange={event => {
        const image = media.find(item => item.id === event.target.value); if (image) command('insertHTML', `<figure><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt || image.title)}"></figure><p><br></p>`);
      }}><option value="">یک تصویر انتخاب کنید</option>{media.map(item => <option key={item.id} value={item.id}>{item.title || item.alt || item.url}</option>)}</select></label>
      {!media.length && <p className="text-xs text-slate-500">ابتدا تصویر را در بخش «رسانه‌ها» اضافه کنید.</p>}
    </div>}
    <div ref={editor} contentEditable suppressContentEditableWarning role="textbox" aria-label="متن نوشته" aria-multiline="true"
      onInput={() => { remember(); onChange(editor.current?.innerHTML || ''); }} onMouseUp={remember} onKeyUp={remember}
      onPaste={event => { event.preventDefault(); command('insertText', event.clipboardData.getData('text/plain')); }}
      onDrop={event => { event.preventDefault(); command('insertText', event.dataTransfer.getData('text/plain')); }}
      className="min-h-[380px] p-5 outline-none focus:ring-2 focus:ring-inset focus:ring-sky-300 text-sm leading-8 [&_h2]:text-xl [&_h2]:font-black [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pr-6 [&_ol]:pr-6 [&_blockquote]:border-r-4 [&_blockquote]:border-sky-300 [&_blockquote]:pr-4 [&_img]:max-w-full [&_a]:text-sky-700 [&_a]:underline" />
  </div>;
}
