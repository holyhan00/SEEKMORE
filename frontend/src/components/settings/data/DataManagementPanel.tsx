                                                                
import { useLocalize } from '../../../localization/useLocalize';
import { useState } from 'react';
import SettingButton from '../SettingButton';
import MemorySettingsPanel from '../memory/MemorySettingsPanel';

type DataView = 'overview' | 'memory';

export default function DataManagementPanel(_props: {  }) {
  const localize = useLocalize();
  const [view, setView] = useState<DataView>('overview');

  const contentBgClass = 'bg-surface-settings text-gray-700  dark:text-gray-300';

  if (view === 'memory') {
    return (
      <div className={`${contentBgClass} h-full overflow-hidden p-[10px]`}>
        <MemorySettingsPanel

          onBack={() => setView('overview')}
        />
      </div>
    );
  }

  return (
    <div className={`${contentBgClass} min-h-full px-[16px] py-[16px]`}>
      <div className="flex w-full flex-col items-center space-y-3">
        <SettingButton

          variant="secondary"
          className="w-full text-[12px] pl-[14px]"
          onClick={() => setView('memory')}
        >
          {localize('memory.savedTitle')}
        </SettingButton>
      </div>
    </div>
  );
}