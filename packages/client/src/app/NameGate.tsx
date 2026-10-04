import { useState } from 'react';
import { setName } from '../net/storage';
import { HeroLayout } from './HeroLayout';

export function NameGate({ onDone }: { onDone: (name: string) => void }) {
  const [name, setNameState] = useState('');
  const ok = name.trim().length > 0;
  return (
    <HeroLayout>
      <h1 className="landing-title">Towers</h1>
      <form className="landing-form" onSubmit={(e) => { e.preventDefault(); if (ok) { setName(name); onDone(name.trim()); } }}>
        <input className="field" autoFocus maxLength={24} spellCheck={false} placeholder="Your name" aria-label="Your name"
          value={name} onChange={(e) => setNameState(e.target.value)} />
        <div className="landing-actions">
          <button type="submit" className="btn primary" disabled={!ok}>Join</button>
        </div>
      </form>
    </HeroLayout>
  );
}
