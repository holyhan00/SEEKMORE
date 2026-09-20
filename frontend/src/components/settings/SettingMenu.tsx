                                                  
import React from 'react';
import SettingButton from './SettingButton';
import { useLocalize } from '../../localization/useLocalize';

export type SettingMenuKey = 'general' | 'model' | 'data' | 'help';

interface SettingMenuProps {
  activeKey: SettingMenuKey;
  onSelect: (key: SettingMenuKey) => void;
}

const SettingMenu: React.FC<SettingMenuProps> = ({
  activeKey,
  onSelect,
}) => {
  const t = useLocalize();
  const menuItems: Array<{ label: string; key: SettingMenuKey }> = [
    { label: t('settings.general'), key: 'general' },
    { label: t('settings.model'), key: 'model' },
    { label: t('settings.data'), key: 'data' },
    { label: t('settings.help'), key: 'help' },
  ];

  const menuBgClass = 'bg-surface-button-muted text-theme-strong  ';

  return (
    <div className={`flex flex-col items-center py-4 px-3 mt-[40px] w-full ${menuBgClass} rounded-xl select-none`}>
      {menuItems.map((item) => (
        <SettingButton
          key={item.key}

          variant={activeKey === item.key ? 'primary' : 'secondary'}
          onClick={() => onSelect(item.key)}
        >
          {item.label}
        </SettingButton>
      ))}
    </div>
  );
};

export default SettingMenu;
