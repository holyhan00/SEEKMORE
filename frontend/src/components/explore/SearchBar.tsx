import { resolveAssetUrl } from '../../utils/asset-url';
                                                
import { useLocalize } from '../../localization/useLocalize';

import type {
  ChangeEvent,
} from 'react';

export default function SearchBar({
  value,
    onChange,
}: {
  value: string;

  onChange: (
    value: string,
  ) => void;
}) {
  const localize = useLocalize();
  return (
    <div
      className={`
        relative
        flex
        h-[50px]
        w-full
        min-w-0
        items-center
        rounded-full
        transition-colors
        select-none
        ${
          'bg-[#f1f1f1]/95 dark:bg-[#191919]/95'
        }
      `}
      style={{
        boxShadow: 'none',
        userSelect: 'none',
      }}
    >
      <div
        className="
          pointer-events-none
          absolute
          left-[20px]
          top-1/2
          flex
          -translate-y-1/2
          items-center
        "
        style={{
          userSelect: 'none',
        }}
      >
        <img
          src={resolveAssetUrl('/icons/search.svg')}
          alt="" aria-hidden="true"
          className="
            h-[18px]
            w-[18px]
            brightness-0
            dark:invert
          "
          draggable={false}
          style={{
            userSelect: 'none',
            opacity: 0.6,
          }}
        />
      </div>

      <input
        value={value}
        onChange={(
          event:
            ChangeEvent<HTMLInputElement>,
        ) =>
          onChange(
            event.target.value,
          )
        }
        placeholder={localize('explore.searchPlaceholder')}
        className={`
          h-full
          w-full
          min-w-0
          bg-transparent
          text-[12px]
          outline-none
          placeholder:opacity-50
          ${
            'text-theme-primary placeholder:text-theme-primary'
          }
        `}
        style={{
          paddingLeft: 50,
          paddingRight: 10,
          boxShadow: 'none',
          WebkitBoxShadow: 'none',
          border: 'none',
          outline: 'none',
          userSelect: 'none',
        }}
      />
    </div>
  );
}