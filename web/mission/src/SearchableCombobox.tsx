import { useEffect, useMemo, useRef, useState } from "react";
import {t,getLanguage} from '../../i18n.js';

export type ComboboxOption = {
  id: number;
  label: string;
  secondary?: string;
  group: string;
};

type Props = {
  options: ComboboxOption[];
  value: number;
  onChange: (id: number) => void;
  placeholder?: string;
  emptyLabel?: string;
};

export function SearchableCombobox({
  options,
  value,
  onChange,
  placeholder = "搜索…",
  emptyLabel = "(none)",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.id === value);
  const language=getLanguage();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        t(o.label).toLowerCase().includes(q) ||
        t(o.secondary || '').toLowerCase().includes(q) ||
        o.label.toLowerCase().includes(q) ||
        (o.secondary || "").toLowerCase().includes(q) ||
        o.group.toLowerCase().includes(q) ||
        String(o.id) === q
    );
  }, [options, query, language]);

  const grouped = useMemo(() => {
    const map = new Map<string, ComboboxOption[]>();
    for (const o of filtered) {
      const list = map.get(o.group) || [];
      list.push(o);
      map.set(o.group, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="combo" ref={rootRef}>
      <button
        type="button"
        className="combo-trigger"
        title={selected?.secondary ? t(selected.secondary) : undefined}
        onClick={() => {
          setOpen((v) => !v);
          setQuery("");
        }}
      >
        <span className="combo-label">
          {selected?.label || (value === 0 ? emptyLabel : `id ${value}`)}
        </span>
      </button>
      {open && (
        <div className="combo-pop">
          <input
            className="combo-search"
            autoFocus
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          />
          <div className="combo-list">
            {grouped.length === 0 && (
              <div className="combo-empty">无匹配项</div>
            )}
            {grouped.map(([group, opts]) => (
              <div key={group} className="combo-group">
                <div className="combo-group-title">{group}</div>
                {opts.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    title={o.secondary ? t(o.secondary) : undefined}
                    className={
                      o.id === value ? "combo-option active" : "combo-option"
                    }
                    onClick={() => {
                      onChange(o.id);
                      setOpen(false);
                    }}
                  >
                    <span>{o.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function groupBySymbolPrefix(symbol: string, fallback = "Other"): string {
  if (!symbol) return fallback;
  const i = symbol.indexOf("_");
  return i > 0 ? symbol.slice(0, i) : symbol;
}
