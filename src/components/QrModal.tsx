import React from 'react';
import { X, Copy, Check, QrCode } from 'lucide-react';
import { generateQrSvg } from '../utils/qrcode';

interface QrModalProps {
  email: string;
  isOpen: boolean;
  onClose: () => void;
  isFa: boolean;
  onCopy: () => void;
  isCopied: boolean;
}

export const QrModal: React.FC<QrModalProps> = ({
  email,
  isOpen,
  onClose,
  isFa,
  onCopy,
  isCopied,
}) => {
  if (!isOpen) return null;

  const qrImageUrl = generateQrSvg(email, 240);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-2xl text-center transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="inline-flex p-3 rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400 mb-4">
          <QrCode className="w-8 h-8" />
        </div>

        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">
          {isFa ? 'اسکن بارکد QR ایمیل' : 'Scan Email QR Code'}
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
          {isFa
            ? 'دوربین گوشی خود را جلوی بارکد بگیرید تا آدرس ایمیل سریعاً کپی شود'
            : 'Scan this QR code with your phone camera to open or copy this address'}
        </p>

        <div className="bg-white p-4 rounded-xl inline-block border border-slate-200 dark:border-transparent shadow-xs mb-4">
          <img
            src={qrImageUrl}
            alt={`QR Code for ${email}`}
            className="w-48 h-48 mx-auto"
            loading="lazy"
          />
        </div>

        <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 flex items-center justify-between gap-2 mb-4">
          <span className="font-mono text-xs text-slate-800 dark:text-slate-300 truncate select-all">{email}</span>
          <button
            onClick={onCopy}
            className="p-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white shrink-0 text-xs flex items-center gap-1 cursor-pointer"
          >
            {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>

        <button
          onClick={onClose}
          className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 text-sm font-medium transition-colors cursor-pointer"
        >
          {isFa ? 'بستن پنجره' : 'Close'}
        </button>
      </div>
    </div>
  );
};
