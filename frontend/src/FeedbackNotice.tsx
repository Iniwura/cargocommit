import type { ReactNode } from 'react';

export function FeedbackNotice({ tone, title, children, onClose, onRetry, link, toast = false }: {
  tone: 'error' | 'success' | 'pending' | 'warning';
  title: string;
  children: ReactNode;
  onClose?: () => void;
  onRetry?: () => void;
  link?: { label: string; href: string };
  toast?: boolean;
}) {
  return <div className={`seldra-notice ${tone}${toast ? ' toast' : ''}`} role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'} aria-live={tone === 'error' || tone === 'warning' ? 'assertive' : 'polite'}>
    <span className="seldra-notice-mark" aria-hidden="true">{tone === 'success' ? '✓' : tone === 'pending' ? '↗' : '!'}</span>
    <div className="seldra-notice-body"><strong>{title}</strong><div className="seldra-notice-copy">{children}</div>{(onRetry || link) && <div className="seldra-notice-actions">{onRetry && <button type="button" onClick={onRetry}>TRY AGAIN ↗</button>}{link && <a href={link.href} target="_blank" rel="noreferrer">{link.label} ↗</a>}</div>}</div>
    {onClose && <button className="seldra-notice-close" type="button" aria-label="Dismiss notification" onClick={onClose}>×</button>}
  </div>;
}
