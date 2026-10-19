import React, { useState, useEffect, useRef } from 'react';
import { 
  MessageSquare, Send, Image as ImageIcon, Mic, Trash2, 
  CheckCircle, AlertCircle, User, Phone, Clock, Search, 
  RefreshCw, X, Play, Pause, ChevronLeft, ShieldAlert
} from 'lucide-react';
import { Ticket, TicketMessage } from '../types';

interface TicketsViewProps {
  isFa: boolean;
}

export const TicketsView: React.FC<TicketsViewProps> = ({ isFa }) => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [replyText, setReplyText] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  
  // File attachments state
  const [attachedFile, setAttachedFile] = useState<string | null>(null); // base64
  const [attachedFileType, setAttachedFileType] = useState<'photo' | 'voice' | null>(null);
  const [attachedFileName, setAttachedFileName] = useState<string>('');

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchTickets();
    const interval = setInterval(fetchTickets, 5000); // Auto refresh every 5s for real-time support feel!
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedTicket) {
      // Keep selected ticket updated from the fresh tickets list
      const fresh = tickets.find(t => t.id === selectedTicket.id);
      if (fresh && JSON.stringify(fresh.messages) !== JSON.stringify(selectedTicket.messages)) {
        setSelectedTicket(fresh);
      }
    }
  }, [tickets]);

  useEffect(() => {
    scrollToBottom();
  }, [selectedTicket?.messages]);

  const fetchTickets = async () => {
    try {
      const res = await fetch('/api/tickets');
      const data = await res.json();
      if (data && data.tickets) {
        setTickets(data.tickets);
        window.dispatchEvent(new CustomEvent('tickets_updated', { detail: { count: data.unreadCount } }));
      }
    } catch (err) {
      console.error('Failed to fetch tickets:', err);
    }
  };

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const getMediaUrl = (url?: string) => {
    if (!url) return '';
    if (url.startsWith('fileId:')) {
      return `/api/telegram/file/${url.substring(7)}`;
    }
    return url;
  };

  const handleSelectTicket = async (ticket: Ticket) => {
    setSelectedTicket(ticket);
    setReplyText('');
    clearAttachment();

    // Mark as read in the backend if it's currently unread
    if (!ticket.isRead) {
      try {
        await fetch(`/api/tickets/${ticket.id}/read`, { method: 'POST' });
        // update local list instantly so badge updates without waiting for next poll
        setTickets(prev => prev.map(t => t.id === ticket.id ? { ...t, isRead: true } : t));
        window.dispatchEvent(new Event('tickets_updated'));
      } catch (err) {
        console.error('Failed to mark ticket as read:', err);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileType = file.type;
    let category: 'photo' | 'voice' | null = null;
    
    if (fileType.startsWith('image/')) {
      category = 'photo';
    } else if (fileType.startsWith('audio/') || fileType.startsWith('video/') || file.name.endsWith('.ogg') || file.name.endsWith('.mp3') || file.name.endsWith('.wav') || file.name.endsWith('.m4a')) {
      category = 'voice';
    }

    if (!category) {
      alert(isFa ? 'لطفاً فقط فایل تصویری یا صوتی انتخاب کنید.' : 'Please select only image or audio files.');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setAttachedFile(reader.result as string);
      setAttachedFileType(category);
      setAttachedFileName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const clearAttachment = () => {
    setAttachedFile(null);
    setAttachedFileType(null);
    setAttachedFileName('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || (!replyText.trim() && !attachedFile)) return;

    setIsSending(true);
    try {
      const res = await fetch(`/api/tickets/${selectedTicket.id}/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: replyText.trim() || undefined,
          fileBase64: attachedFile || undefined,
          fileType: attachedFileType || undefined
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setReplyText('');
        clearAttachment();
        fetchTickets();
      } else {
        alert(isFa ? `خطا در ارسال پیام: ${data.error}` : `Failed to send reply: ${data.error}`);
      }
    } catch (err) {
      console.error('Error sending reply:', err);
      alert(isFa ? 'ارتباط با سرور برقرار نشد.' : 'Failed to connect to the server.');
    } finally {
      setIsSending(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!selectedTicket) return;
    const action = selectedTicket.status === 'open' ? 'close' : 'open';
    try {
      const res = await fetch(`/api/tickets/${selectedTicket.id}/${action}`, { method: 'POST' });
      if (res.ok) {
        fetchTickets();
        setSelectedTicket(prev => prev ? { ...prev, status: action === 'close' ? 'closed' : 'open' } : null);
      }
    } catch (err) {
      console.error('Error toggling status:', err);
    }
  };

  const handleDeleteTicket = async () => {
    if (!selectedTicket) return;
    if (!confirm(isFa ? 'آیا از حذف این تیکت اطمینان دارید؟' : 'Are you sure you want to delete this ticket?')) return;
    
    try {
      const res = await fetch(`/api/tickets/${selectedTicket.id}`, { method: 'DELETE' });
      if (res.ok) {
        setSelectedTicket(null);
        fetchTickets();
      }
    } catch (err) {
      console.error('Error deleting ticket:', err);
    }
  };

  const filteredTickets = tickets.filter(t => {
    const matchesSearch = t.userName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          t.phone.includes(searchTerm) || 
                          t.id.includes(searchTerm);
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getRelativeTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      const diffHr = Math.floor(diffMin / 60);
      const diffDay = Math.floor(diffHr / 24);

      if (diffMin < 1) return isFa ? 'هم‌اکنون' : 'Just now';
      if (diffMin < 60) return isFa ? `${diffMin} دقیقه قبل` : `${diffMin}m ago`;
      if (diffHr < 24) return isFa ? `${diffHr} ساعت قبل` : `${diffHr}h ago`;
      return isFa ? `${diffDay} روز قبل` : `${diffDay}d ago`;
    } catch (e) {
      return '';
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col h-[calc(100vh-100px)] overflow-hidden bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-xs" id="tickets-view-container">
      {/* Top action bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 bg-white dark:bg-slate-950/40 border-b border-slate-200/80 dark:border-slate-800/80 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center border border-amber-500/20 shadow-2xs">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">
              {isFa ? 'مدیریت و پاسخگویی تیکت‌ها' : 'Ticket Support Center'}
            </h2>
            <p className="text-[10px] text-slate-500 font-medium">
              {isFa ? 'ارتباط مستقیم و دوطرفه با کاربران ربات تلگرام' : 'Direct bi-directional chat with bot users'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* Status Filters */}
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-[10px] font-bold border border-slate-200/60 dark:border-slate-700/60">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-lg cursor-pointer transition-all ${
                statusFilter === 'all'
                  ? 'bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 shadow-3xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800'
              }`}
            >
              {isFa ? 'همه' : 'All'}
            </button>
            <button
              onClick={() => setStatusFilter('open')}
              className={`px-3 py-1.5 rounded-lg cursor-pointer transition-all ${
                statusFilter === 'open'
                  ? 'bg-amber-500 text-white shadow-3xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800'
              }`}
            >
              {isFa ? 'باز' : 'Open'}
            </button>
            <button
              onClick={() => setStatusFilter('closed')}
              className={`px-3 py-1.5 rounded-lg cursor-pointer transition-all ${
                statusFilter === 'closed'
                  ? 'bg-emerald-600 text-white shadow-3xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800'
              }`}
            >
              {isFa ? 'بسته' : 'Closed'}
            </button>
          </div>

          <button
            onClick={fetchTickets}
            className="p-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl cursor-pointer border border-slate-200/60 dark:border-slate-700/60 transition-colors shrink-0"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main workspace (split view) */}
      <div className="flex flex-1 overflow-hidden">
        {/* Right Pane: List of tickets (Farsi is RTL, so lists reside on right side in RTL, left side on desktop) */}
        <div className={`w-full md:w-80 border-r md:border-r-0 md:border-l border-slate-200/80 dark:border-slate-800/80 flex flex-col bg-white dark:bg-slate-950/20 shrink-0 ${
          selectedTicket ? 'hidden md:flex' : 'flex'
        }`}>
          {/* Search bar */}
          <div className="p-3 border-b border-slate-200/80 dark:border-slate-800/80 shrink-0 relative">
            <Search className="absolute right-6 top-6 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder={isFa ? 'جستجو نام، تلفن، شناسه...' : 'Search tickets...'}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-3 pr-9 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 focus:ring-1 focus:ring-indigo-500 text-slate-800 dark:text-slate-100 font-medium"
            />
          </div>

          {/* Tickets list */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/40">
            {filteredTickets.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center h-full">
                <MessageSquare className="w-8 h-8 text-slate-300 mb-2" />
                <p className="text-xs text-slate-400 font-medium">
                  {isFa ? 'هیچ تیکتی پیدا نشد' : 'No tickets found'}
                </p>
              </div>
            ) : (
              filteredTickets.map(ticket => {
                const isSelected = selectedTicket?.id === ticket.id;
                const lastMsg = ticket.messages[ticket.messages.length - 1];
                
                return (
                  <button
                    key={ticket.id}
                    onClick={() => handleSelectTicket(ticket)}
                    className={`w-full text-right p-4 flex flex-col gap-2 cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-indigo-50/50 dark:bg-indigo-950/20 border-r-4 border-r-indigo-600 dark:border-r-indigo-400'
                        : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/20'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate flex items-center gap-2">
                        <span>{ticket.userName}</span>
                        {!ticket.isRead && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold bg-rose-500 text-white rounded-full animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.7)] ring-1 ring-rose-400/60 shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping shrink-0" />
                            <span>{isFa ? 'جدید' : 'New'}</span>
                          </span>
                        )}
                      </span>
                      <span className="text-[9px] text-slate-400 font-mono shrink-0">
                        {getRelativeTime(ticket.updatedAt)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium truncate">
                        {ticket.phone || 'بدون شماره'}
                      </span>
                      <span className={`text-[8px] px-1.5 py-0.5 rounded-md font-bold shrink-0 ${
                        ticket.status === 'open'
                          ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                      }`}>
                        {ticket.status === 'open' ? (isFa ? 'باز' : 'Open') : (isFa ? 'بسته' : 'Closed')}
                      </span>
                    </div>

                    {lastMsg && (
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium truncate mt-0.5">
                        {lastMsg.sender === 'admin' ? '👤 پاسخ مدیر: ' : '📱 کاربر: '}
                        {lastMsg.text || (lastMsg.photoUrl ? '🖼️ تصویر' : '🎙️ پیام صوتی')}
                      </p>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Left Pane: Chat Workspace */}
        <div className={`flex-1 flex flex-col bg-slate-100/50 dark:bg-slate-900/40 ${
          !selectedTicket ? 'hidden md:flex items-center justify-center' : 'flex'
        }`}>
          {!selectedTicket ? (
            <div className="flex flex-col items-center justify-center text-center p-8">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-300 dark:text-slate-600 flex items-center justify-center border border-slate-200/40 dark:border-slate-700/40 mb-4 animate-bounce">
                <MessageSquare className="w-8 h-8" />
              </div>
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">
                {isFa ? 'انتخاب تیکت پشتیبانی' : 'Select a Support Ticket'}
              </h3>
              <p className="text-[11px] text-slate-400 max-w-xs font-medium">
                {isFa 
                  ? 'جهت مشاهده گفتگو و پاسخگویی به کاربر، از لیست سمت راست یک تیکت را انتخاب کنید.' 
                  : 'Select a ticket from the sidebar to view details and start messaging.'}
              </p>
            </div>
          ) : (
            <>
              {/* Workspace Header */}
              <div className="flex items-center justify-between p-4 bg-white dark:bg-slate-950/40 border-b border-slate-200/80 dark:border-slate-800/80 shrink-0">
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setSelectedTicket(null)}
                    className="p-1 text-slate-500 hover:text-slate-800 md:hidden cursor-pointer shrink-0"
                  >
                    <ChevronLeft className="w-5 h-5 rtl:rotate-180" />
                  </button>
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center border border-indigo-500/20 shadow-3xs">
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100">
                        {selectedTicket.userName}
                      </h4>
                      <span className={`text-[8px] px-1.5 py-0.5 rounded-md font-bold ${
                        selectedTicket.status === 'open'
                          ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                      }`}>
                        {selectedTicket.status === 'open' ? (isFa ? 'باز' : 'Open') : (isFa ? 'بسته' : 'Closed')}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-slate-400 font-medium mt-0.5">
                      <span className="flex items-center gap-1">
                        <Phone className="w-3 h-3 text-slate-400" />
                        {selectedTicket.phone}
                      </span>
                      <span className="font-mono">ChatID: {selectedTicket.chatId}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleToggleStatus}
                    className={`px-3 py-1.5 rounded-xl text-[10px] font-bold cursor-pointer border transition-colors flex items-center gap-1.5 ${
                      selectedTicket.status === 'open'
                        ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border-emerald-200/60 dark:border-emerald-800/30 hover:bg-emerald-100/60'
                        : 'bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 border-amber-200/60 dark:border-amber-800/30 hover:bg-amber-100/60'
                    }`}
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>
                      {selectedTicket.status === 'open' 
                        ? (isFa ? 'حل شده و بستن تیکت' : 'Mark Resolved') 
                        : (isFa ? 'باز کردن مجدد تیکت' : 'Reopen Ticket')}
                    </span>
                  </button>

                  <button
                    onClick={handleDeleteTicket}
                    className="p-2 text-rose-500 hover:text-rose-600 bg-rose-50 dark:bg-rose-950/20 border border-rose-200/60 dark:border-rose-900/30 rounded-xl cursor-pointer transition-colors shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Chat Message Scrollable Area */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {selectedTicket.messages.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-slate-400 text-xs font-medium">
                    {isFa ? 'هیچ پیامی در این تیکت وجود ندارد.' : 'No messages in this ticket.'}
                  </div>
                ) : (
                  selectedTicket.messages.map((msg) => {
                    const isAdmin = msg.sender === 'admin';
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col max-w-[80%] ${
                          isAdmin 
                            ? 'mr-auto items-end text-left' 
                            : 'ml-auto items-start text-right'
                        }`}
                      >
                        {/* Bubble */}
                        <div
                          className={`p-3.5 rounded-2xl border transition-all relative ${
                            isAdmin
                              ? 'bg-indigo-600 border-indigo-500 text-white shadow-xs rounded-tr-none'
                              : 'bg-white dark:bg-slate-950 border-slate-200/80 dark:border-slate-800/80 text-slate-800 dark:text-slate-100 shadow-3xs rounded-tl-none'
                          }`}
                        >
                          {/* Photo content */}
                          {msg.photoUrl && (
                            <div className="mb-2 max-w-sm rounded-lg overflow-hidden border border-slate-200/40 bg-slate-50 dark:bg-slate-900 shrink-0">
                              <img
                                src={getMediaUrl(msg.photoUrl)}
                                alt="Attachment"
                                referrerPolicy="no-referrer"
                                className="max-h-60 w-auto object-contain cursor-pointer hover:opacity-95"
                                onClick={() => window.open(getMediaUrl(msg.photoUrl), '_blank')}
                              />
                            </div>
                          )}

                          {/* Voice note content */}
                          {msg.voiceUrl && (
                            <div className="mb-2 min-w-[200px] shrink-0">
                              <audio
                                src={getMediaUrl(msg.voiceUrl)}
                                controls
                                className="w-full h-8 opacity-90"
                              />
                            </div>
                          )}

                          {/* Text content */}
                          {msg.text && (
                            <p className="text-xs font-medium leading-relaxed whitespace-pre-wrap">
                              {msg.text}
                            </p>
                          )}
                        </div>

                        {/* Timestamp */}
                        <span className="text-[8px] text-slate-400 font-mono mt-1 px-1">
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  })
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Chat Reply Area */}
              <div className="p-4 bg-white dark:bg-slate-950/40 border-t border-slate-200/80 dark:border-slate-800/80 shrink-0 flex flex-col gap-3">
                {/* File Attachment preview */}
                {attachedFile && (
                  <div className="flex items-center justify-between p-2 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 rounded-xl">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {attachedFileType === 'photo' ? (
                        <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-indigo-200/60 bg-white">
                          <img src={attachedFile} alt="Preview" className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-indigo-500/10 text-indigo-500 flex items-center justify-center shrink-0 border border-indigo-500/20">
                          <Mic className="w-5 h-5 animate-pulse" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200 truncate">
                          {attachedFileName}
                        </p>
                        <p className="text-[9px] text-slate-400 font-medium capitalize">
                          {attachedFileType === 'photo' ? (isFa ? 'تصویر ضمیمه شده' : 'Photo Attached') : (isFa ? 'صدا ضمیمه شده' : 'Voice Attached')}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={clearAttachment}
                      className="p-1.5 bg-white dark:bg-slate-950 hover:bg-slate-100 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-lg border border-slate-200/60 dark:border-slate-800 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* Form controls */}
                <form onSubmit={handleSendReply} className="flex gap-2.5 items-center">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept="image/*,audio/*"
                    className="hidden"
                  />

                  {/* Attachment Button */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2.5 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 rounded-xl border border-slate-200/80 dark:border-slate-800 cursor-pointer shrink-0 transition-colors"
                    title={isFa ? 'پیوست عکس یا پیام صوتی' : 'Attach image or audio'}
                  >
                    <ImageIcon className="w-4 h-4" />
                  </button>

                  {/* Text Input */}
                  <input
                    type="text"
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    placeholder={isFa ? 'پاسخ خود را بنویسید...' : 'Type a reply...'}
                    disabled={isSending}
                    className="flex-1 px-4 py-2.5 text-xs font-semibold rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 focus:ring-1 focus:ring-indigo-500 text-slate-800 dark:text-slate-100"
                  />

                  {/* Send Button */}
                  <button
                    type="submit"
                    disabled={isSending || (!replyText.trim() && !attachedFile)}
                    className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl cursor-pointer font-bold text-xs flex items-center gap-1.5 transition-colors shadow-xs hover:shadow-sm shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSending ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>{isFa ? 'ارسال' : 'Send'}</span>
                      </>
                    )}
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
