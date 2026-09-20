import { memo } from 'react';

type Props = { value: string;  };

function DiffViewer({ value }: Props) {
  const lines = value.split('\n');
  return (
    <div className={`overflow-x-auto rounded-lg border font-mono text-[11px] leading-5 ${'border-edge-alpha-10 bg-[#ffffff]  dark:bg-[#000000]/30'}`}>
      {lines.map((line, index) => {
        const kind = line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'remove' : line.startsWith('@@') ? 'hunk' : 'plain';
        const tone = kind === 'add' ? ('bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300') : kind === 'remove' ? ('bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300') : kind === 'hunk' ? ('bg-sky-50 text-sky-800 dark:bg-sky-500/10 dark:text-sky-300') : '';
        return <div key={`${index}:${line.slice(0, 16)}`} className={`whitespace-pre px-3 ${tone}`}><span className="mr-3 select-none opacity-35">{String(index + 1).padStart(3, ' ')}</span>{line || ' '}</div>;
      })}
    </div>
  );
}

export function looksLikeDiff(value: string): boolean {
  return /(^|\n)(diff --git |@@ |--- |\+\+\+ )/.test(value);
}

export default memo(DiffViewer);
