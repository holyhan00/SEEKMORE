import { resolveAssetUrl } from '../../utils/asset-url';
import { useLocalize } from '../../localization/useLocalize';
                                                             

import type { MyAgentSection } from './myagent.types';

interface MyAgentNavigationPanelProps {

  selected: MyAgentSection;
  onChange: (section: MyAgentSection) => void;
}

interface NavigationItem {
  id: MyAgentSection;
  titleKey: string;
  descriptionKey: string;
}

const items: NavigationItem[] = [
  {
    id: 'cognitive',
    titleKey: 'myagent.nav.cognitive.title',
    descriptionKey: 'myagent.nav.cognitive.description',
  },
  {
    id: 'embodied',
    titleKey: 'myagent.nav.embodied.title',
    descriptionKey: 'myagent.nav.embodied.description',
  },
  {
    id: 'skill',
    titleKey: 'myagent.nav.skill.title',
    descriptionKey: 'myagent.nav.skill.description',
  },
  {
    id: 'mcp',
    titleKey: 'myagent.nav.mcp.title',
    descriptionKey: 'myagent.nav.mcp.description',
  },
  {
    id: 'plugins',
    titleKey: 'myagent.nav.tool.title',
    descriptionKey: 'myagent.nav.tool.description',
  },
  {
    id: 'recycle',
    titleKey: 'myagent.nav.recycle.title',
    descriptionKey: 'myagent.nav.recycle.description',
  },
];

export default function MyAgentNavigationPanel({
    selected,
  onChange,
}: MyAgentNavigationPanelProps) {
  const localize = useLocalize();
  return (
    <aside
      className={`
        box-border
        flex
        h-full
        min-h-0
        min-w-0
        w-full
        max-w-full
        flex-col
        overflow-hidden
        pb-5
        pt-[52px]
        bg-transparent
      `}
    >
      {                          }
      <header className="mt-[-10px] pb-[5px] flex justify-center">
        <div className="h-[36px] px-[10px] max-w-[180px] overflow-hidden">
          <img
  src={resolveAssetUrl('/logo.svg')}
  alt=""
  draggable={false}
  className="h-full w-full select-none object-contain dark:brightness-0 dark:invert"
/>
        </div>
      </header>

      <nav
        className="
          mx-[10px]
          flex
          min-h-0
          min-w-0
          flex-col
          gap-2
        "
      >
        {items.map((item) => {
          const active = selected === item.id;

          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(item.id)}
              className={`
                box-border
                flex
                h-[46px]
                min-h-[46px]
                min-w-0
                w-full
                max-w-full
                shrink-0
                cursor-pointer
                items-center
                overflow-hidden
                rounded-[8px]
                border-0
                p-[5px]
                text-left
                outline-none
                transition-colors
                duration-200
                ${
                  active
                    ? 'bg-[#e8e8e8] text-theme-primary dark:bg-[#292929] dark:text-[#ffffff]'
                    : 'bg-surface-base text-theme-primary hover:bg-[#f2f2f2]   dark:hover:bg-[#232323]'
                }
              `}
            >
              <span
                className="
                  flex
                  min-w-0
                  flex-1
                  flex-col
                  justify-center
                  overflow-hidden
                  px-[5px]
                "
              >
                <span
                  className="
                    min-w-0
                    max-w-full
                    truncate
                    select-none
                    text-[12px]
                    leading-tight
                  "
                >
                  {localize(item.titleKey)}
                </span>

                <span
                  className="
                    min-w-0
                    max-w-full
                    truncate
                    select-none
                    text-[8px]
                    leading-tight
                    opacity-50
                  "
                >
                  {localize(item.descriptionKey)}
                </span>
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}