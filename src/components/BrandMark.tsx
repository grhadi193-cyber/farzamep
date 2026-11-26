import { useState } from 'react';
import { COMPANY_INFO } from '../lib/seedData';

interface BrandMarkProps {
  compact?: boolean;
  forPrint?: boolean;
}

export function BrandMark({ compact = false, forPrint = false }: BrandMarkProps) {
  const [logoFailed, setLogoFailed] = useState(false);
  const [faFailed, setFaFailed] = useState(false);
  const [enFailed, setEnFailed] = useState(false);

  return (
    <div className={`flex items-center gap-3 ${forPrint ? 'text-black' : 'text-[#F8FAFC]'}`}>
      {!logoFailed ? (
        <img
          src="/assets/af-logo.svg"
          alt="نشان تجاری آتی فرزام ایرانیان"
          className={`h-10 w-10 shrink-0 rounded-lg object-contain ${forPrint ? 'print-invert-logo' : ''}`}
          onError={() => setLogoFailed(true)}
          referrerPolicy="no-referrer"
        />
      ) : (
        <svg
          viewBox="0 0 48 48"
          className="h-10 w-10 shrink-0"
          aria-label="نشان تجاری آتی فرزام ایرانیان"
        >
          <rect
            x="2"
            y="2"
            width="44"
            height="44"
            rx="10"
            fill={forPrint ? '#FFFFFF' : '#1E3A72'}
            stroke={forPrint ? '#000000' : '#FF7A00'}
            strokeWidth="2.5"
          />
          <path
            d="M13 33L21.5 13H26.5L35 33H30.2L28.4 28.4H19.6L17.8 33H13ZM21.2 24.4H26.8L24 17.3L21.2 24.4Z"
            fill={forPrint ? '#000000' : '#F8FAFC'}
          />
          <rect x="19" y="34.5" width="10" height="3" rx="1.5" fill={forPrint ? '#000000' : '#FF7A00'} />
        </svg>
      )}

      {!compact && (
        <div className="min-w-0 flex flex-col">
          {!faFailed ? (
            <img
              src="/assets/wordmark-fa.svg"
              alt={COMPANY_INFO.nameFa}
              className={`h-6 w-auto max-w-[168px] object-contain object-right ${forPrint ? 'print-invert-logo' : ''}`}
              onError={() => setFaFailed(true)}
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="truncate text-sm font-extrabold leading-tight">
              {COMPANY_INFO.shortNameFa}
            </span>
          )}

          {!enFailed ? (
            <img
              src="/assets/wordmark-en.svg"
              alt={COMPANY_INFO.nameEn}
              className={`mt-0.5 h-3.5 w-auto max-w-[132px] object-contain object-right ${forPrint ? 'print-invert-logo' : ''}`}
              onError={() => setEnFailed(true)}
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="mono-ltr text-[10px] font-semibold tracking-wider text-[#FF7A00]">
              ATI FARZAM ERP
            </span>
          )}
        </div>
      )}
    </div>
  );
}
