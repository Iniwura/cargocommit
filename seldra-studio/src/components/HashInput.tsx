import { useState } from 'react';
import { hashFile, hashText, isBytes32 } from '@/lib/hash';
import { shortHash } from '@/lib/format';
import { Field } from './ui';

type Mode = 'text' | 'file' | 'hash';

/**
 * Turns an offchain reference into a bytes32 commitment in the browser.
 * Text and files are hashed locally; nothing is uploaded anywhere.
 */
export function HashInput(props: {
  label: string;
  hint: string;
  onChange: (hash: `0x${string}` | '') => void;
  allowEmpty?: boolean;
}) {
  const { label, hint, onChange } = props;
  const [mode, setMode] = useState<Mode>('text');
  const [value, setValue] = useState('');
  const [fileName, setFileName] = useState('');
  const [hash, setHash] = useState<`0x${string}` | ''>('');
  const [error, setError] = useState<string>();

  const commit = (next: `0x${string}` | '', problem?: string) => {
    setHash(next);
    setError(problem);
    onChange(next);
  };

  const changeMode = (next: Mode) => {
    setMode(next);
    setValue('');
    setFileName('');
    commit('');
  };

  return (
    <Field label={label} hint={hint} error={error}>
      <div className="segmented" role="tablist" aria-label={`${label} input type`}>
        {(['text', 'file', 'hash'] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => changeMode(m)}>
            {m === 'text' ? 'Text reference' : m === 'file' ? 'Hash a file' : 'Paste a hash'}
          </button>
        ))}
      </div>
      {mode === 'text' ? (
        <textarea
          rows={2}
          value={value}
          placeholder="Bill of lading no., tracking id, document URL…"
          onChange={(e) => {
            setValue(e.target.value);
            commit(e.target.value.trim() ? hashText(e.target.value) : '');
          }}
        />
      ) : null}
      {mode === 'file' ? (
        <input
          type="file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return commit('');
            setFileName(file.name);
            hashFile(file).then((h) => commit(h), () => commit('', 'Could not read that file.'));
          }}
        />
      ) : null}
      {mode === 'hash' ? (
        <input
          className="mono"
          value={value}
          placeholder="0x… (32 bytes)"
          spellCheck={false}
          onChange={(e) => {
            const v = e.target.value.trim();
            setValue(e.target.value);
            if (v === '') commit('');
            else if (isBytes32(v)) commit(v);
            else commit('', 'A commitment hash is 0x followed by 64 hex characters.');
          }}
        />
      ) : null}
      {hash ? (
        <p className="hash-preview mono" aria-live="polite">
          Commitment {shortHash(hash)}{fileName ? ` · ${fileName}` : ''}
        </p>
      ) : null}
    </Field>
  );
}
