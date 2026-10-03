import { useState } from 'react';
import { copyText } from './clipboard';

/** Non-blocking: sits above the board so the creator can set up underneath. */
export function ShareOverlay({ link, onDismiss }: { link: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="share-overlay" role="region" aria-label="Invite link">
      <input className="share-link" readOnly value={link} aria-label="Game link" onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="btn primary"
        onClick={async () => { await copyText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button type="button" className="share-close" aria-label="Dismiss" onClick={onDismiss}>&times;</button>
    </div>
  );
}
