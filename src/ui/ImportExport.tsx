import { useRef, useState } from 'react';
import { ImportError, encodeShare, exportLibrary, exportSpell, importAny, decodeShare } from '../core/serialize';
import { useStore } from '../state/store';

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function shareUrl(): string {
  const doc = useStore.getState().active();
  return `${location.origin}${location.pathname}#spell=${encodeShare(doc)}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ImportExportModal() {
  const open = useStore((s) => s.ui.ioOpen);
  const setUI = useStore((s) => s.setUI);
  const doc = useStore((s) => s.active());
  const library = useStore((s) => s.library);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!open) return null;
  const st = useStore.getState;
  const json = exportSpell(doc);
  const doImport = (src: string) => {
    setError(null);
    setWarnings([]);
    try {
      const trimmed = src.trim();
      const parsed = trimmed.startsWith('{') ? importAny(trimmed) : (() => {
        const code = trimmed.includes('#spell=') ? trimmed.split('#spell=')[1] : trimmed;
        const r = decodeShare(code);
        return { docs: [r.doc], warnings: r.warnings };
      })();
      const ids = st().importDocs(parsed.docs);
      setWarnings(parsed.warnings);
      st().toast(`Imported ${ids.length} spell${ids.length === 1 ? '' : 's'}${parsed.warnings.length ? ` with ${parsed.warnings.length} warning(s)` : ''}`, 'success');
      if (!parsed.warnings.length) setUI({ ioOpen: false });
      setText('');
    } catch (e) {
      setError(e instanceof ImportError ? e.message : `Import failed: ${(e as Error).message}`);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setUI({ ioOpen: false })}>
      <div className="modal io" role="dialog" aria-label="Import and export" data-testid="io-modal">
        <header>
          <h2>Share & Save</h2>
          <button className="x" onClick={() => setUI({ ioOpen: false })} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="io-cols">
          <section>
            <h4>Export “{doc.name}”</h4>
            <textarea readOnly value={json} spellCheck={false} data-testid="export-json" />
            <div className="row-btns">
              <button className="btn" onClick={async () => st().toast((await copyText(json)) ? 'Spell JSON copied' : 'Clipboard blocked — select the text instead', 'info')}>
                Copy JSON
              </button>
              <button className="btn" onClick={() => download(`${doc.name.replace(/[^\w-]+/g, '_')}.spell.json`, json)}>
                Download .spell.json
              </button>
              <button className="btn primary" onClick={async () => st().toast((await copyText(shareUrl())) ? 'Share link copied — anyone opening it gets this spell' : 'Clipboard blocked', 'success')}>
                Copy share link
              </button>
            </div>
            <div className="row-btns">
              <button className="btn" onClick={() => download('grimoire.library.json', exportLibrary(library))}>
                Download whole library ({library.length})
              </button>
            </div>
          </section>
          <section>
            <h4>Import</h4>
            <textarea
              placeholder="Paste spell JSON, a library export, or a share link / code…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              data-testid="import-json"
            />
            {error && <div className="io-error">✕ {error}</div>}
            {warnings.length > 0 && (
              <div className="io-warn">
                {warnings.map((w, i) => (
                  <div key={i}>▲ {w}</div>
                ))}
              </div>
            )}
            <div className="row-btns">
              <button className="btn primary" disabled={!text.trim()} onClick={() => doImport(text)} data-testid="import-btn">
                Import
              </button>
              <button className="btn" onClick={() => fileRef.current?.click()}>
                Open file…
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) doImport(await f.text());
                  e.target.value = '';
                }}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
