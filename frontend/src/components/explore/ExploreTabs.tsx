                                                  
import { useLocalize } from '../../localization/useLocalize';
import type { ExploreTab } from './explore.types';

const tabs: Array<{ id: ExploreTab; labelKey?: string; label?: string }> = [
  { id: 'OVERVIEW', labelKey: 'explore.tabs.overview' },
  { id: 'AGENT', labelKey: 'explore.tabs.agents' },
  { id: 'SKILL', label: 'SKILL' },
];

export default function ExploreTabs({
  active,
    onChange,
}: {
  active: ExploreTab;

  onChange: (tab: ExploreTab) => void;
}) {
  const localize = useLocalize();
  return (
    <nav className="mx-auto grid w-full max-w-[420px] min-w-0 grid-cols-3 select-none gap-[10px] [&_button]:!select-none [&_button_*]:!select-none" aria-label={localize('explore.categories')}>
      {tabs.map((tab) => {
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            aria-current={selected ? 'page' : undefined}
            onClick={() => onChange(tab.id)}
            className={`h-[34px] w-full min-w-0 truncate rounded-full px-[10px] text-[12px] font-medium transition-colors ${
              selected
                ? 'bg-action-primary text-[#ffffff] '
                : 'bg-[#ededed] text-[#4f4f4f] hover:bg-[#e5e5e5] dark:bg-[#262626] dark:text-[#d8d8d8] dark:hover:bg-[#303030]'
            }`}
          >
            {tab.labelKey ? localize(tab.labelKey) : tab.label}
          </button>
        );
      })}
    </nav>
  );
}
