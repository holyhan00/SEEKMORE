                                                      
import React from 'react';
import type { SettingMenuKey } from './SettingMenu';
import DataManagementPanel from './data/DataManagementPanel';
import GeneralSettingsPanel from './general/GeneralSettingsPanel';
import ModelSettingsPanel from './model/ModelSettingsPanel';
import { useLocalize } from '../../localization/useLocalize';

interface SettingContentProps {
  activeKey: SettingMenuKey;
}

const SettingContent: React.FC<SettingContentProps> = ({
  activeKey,
}) => {
  const t = useLocalize();
  const contentBgClass = 'bg-surface-settings text-gray-700  dark:text-gray-300';

  if (activeKey === 'general') {
    return (
      <GeneralSettingsPanel
      />
    );
  }
  if (activeKey === 'data') {
    return <DataManagementPanel  />;
  }
  if (activeKey === 'model') {
    return <ModelSettingsPanel  />;
  }

  const titleMap: Record<SettingMenuKey, string> = {
    general: t('settings.general'),
    model: t('settings.model'),
    data: t('settings.data'),
    help: t('settings.help'),
  };

  return (
    <div className={`${contentBgClass} min-h-full p-6`}>
      <div className="select-none text-[20px] font-semibold mb-[10px]">{titleMap[activeKey]}</div>
      <div className={'text-[13px] text-gray-500 dark:text-[13px] dark:text-gray-400'}>
        {t('settings.moreComing')}
      </div>
    </div>
  );
};

export default SettingContent;
