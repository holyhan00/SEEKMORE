import { useAppearance } from '../theme/useAppearance';
import { useLocalize } from '../localization/useLocalize';
                                                  
import React, {
  Dispatch,
  SetStateAction,
  useEffect,
  useState,
} from 'react';
import { useAuth } from '../hooks/auth/useAuth';
import { useAuthenticatedImageUrl } from '../hooks/useAuthenticatedImageUrl';
import UserProfileModal from '../components/sidebar/UserProfileModal';
import { getAvatarInitial } from '../utils/avatar-initial';
import { resolveAssetUrl } from '../utils/asset-url';

type ViewType =
  | 'chat'
  | 'myagent'
  | 'explore';

interface LeftSidebarProps {
  currentView: ViewType;
  setView: Dispatch<
    SetStateAction<ViewType>
  >;
  onOpenSettings: () => void;
  isSettingsOpen: boolean;
}

const navItems = [
  {
    icon: 'chat.svg',
    view: 'chat' as ViewType,
    labelKey: 'sidebar.nav.chat',
  },
  {
    icon: 'my.svg',
    view: 'myagent' as ViewType,
    labelKey: 'sidebar.nav.myagent',
  },
  {
    icon: 'explore.svg',
    view: 'explore' as ViewType,
    labelKey: 'sidebar.nav.explore',
  },
];

const bottomItems = [
  {
    icon: 'setting.svg',
    view: 'setting',
    labelKey:
      'sidebar.nav.settings',
  },
];

const LeftSidebar: React.FC<
  LeftSidebarProps
> = ({
  currentView,
  setView,
  onOpenSettings,
  isSettingsOpen,
}) => {
  const { resolvedTheme } =
    useAppearance();

  const isDarkTheme =
    resolvedTheme === 'dark';

  const localize = useLocalize();

  const {
    profile,
    refreshProfile,
  } = useAuth();

  const sidebarBg =
    'bg-[#ececed] dark:bg-[#333233]';

  const selected =
    'bg-[#dcdcdc] dark:bg-[#444344]';

  const hoverClass =
    'bg-[#eaeaea] dark:bg-[#555455]';

                      
  const BTN =
    'w-[28px] h-[28px] ';

  const ICON =
    'w-[16px] h-[16px]';

  const AVATAR =
    'w-[42px] h-[42px]';

  const baseClass =
    `${BTN} rounded-[6px] flex items-center justify-center cursor-pointer transition-colors duration-150 flex-none`;

  const [
    pendingView,
    setPendingView,
  ] = useState<ViewType | null>(
    null,
  );

  const [
    profileOpen,
    setProfileOpen,
  ] = useState(false);

  const resolvedUserAvatarUrl =
    useAuthenticatedImageUrl(
      resolveAssetUrl(
        profile?.avatarUrl,
        {
          version:
            profile?.avatarUpdatedAt,
        },
      ),
    );

  const userAvatarInitial =
    getAvatarInitial(
      profile?.username,
      'S',
    );

  useEffect(() => {
    if (
      pendingView &&
      pendingView === currentView
    ) {
      setPendingView(null);
    }
  }, [
    currentView,
    pendingView,
  ]);

  const activeView: ViewType =
    pendingView || currentView;

  const getIconSrc = (
    item: {
      icon: string;
      view:
        | string
        | ViewType;
    },
  ) => {
    const isActive =
      activeView === item.view ||
      (
        item.view ===
          'setting' &&
        isSettingsOpen
      );

    if (isActive) {
      return resolveAssetUrl(`/icons/blue/${item.icon.replace(
        '.svg',
        'blue.svg',
      )}`);
    }

    return isDarkTheme
      ? resolveAssetUrl(`/icons/white/${item.icon.replace(
          '.svg',
          '1.svg',
        )}`)
      : resolveAssetUrl(`/icons/${item.icon}`);
  };

  const handleClick = (
    view: ViewType,
  ) => {
    setPendingView(view);
    setView(view);
  };

  const handleSettingClick =
    () => {
      onOpenSettings();
    };

  return (
    <>
      <div
        className={`w-full h-full flex flex-col justify-between items-center py-4 ${sidebarBg} select-none`}
      >
        {        }
        <div
          className="flex flex-col items-center gap-5"
          style={{
            marginTop: 42,
          }}
        >
          {          }
          <button
            type="button"
            className={`
              ${AVATAR}
              flex-none
              overflow-hidden
              border-0
              rounded-[8px]
              p-0
              text-[#ffffff]
              ${
                resolvedUserAvatarUrl
                  ? 'bg-transparent'
                  : 'bg-[#0c5cfb]'
              }
            `}
            onClick={() => {
              setProfileOpen(true);
              void refreshProfile();
            }}
            title={localize(
              'sidebar.user.editProfile',
            )}
          >
            {resolvedUserAvatarUrl ? (
              <img
                src={
                  resolvedUserAvatarUrl
                }
                alt={localize(
                  'sidebar.user.avatarAlt',
                )}
                className="block h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              userAvatarInitial
            )}
          </button>

          {         }
          {navItems.map(
            (item) => (
              <div
                key={item.view}
                className={`${baseClass} ${
                  activeView ===
                  item.view
                    ? selected
                    : ''
                }`}
                onMouseEnter={(
                  e,
                ) =>
                  (
                    e.currentTarget
                      .className +=
                    ` ${hoverClass}`
                  )
                }
                onMouseLeave={(
                  e,
                ) => {
                  e.currentTarget
                    .className =
                    e.currentTarget.className.replace(
                      ` ${hoverClass}`,
                      '',
                    );
                }}
                onClick={() =>
                  handleClick(
                    item.view,
                  )
                }
                title={localize(
                  item.labelKey,
                )}
              >
                <img
                  src={getIconSrc(
                    item,
                  )}
                  alt={localize(
                    item.labelKey,
                  )}
                  className={`${ICON} object-contain`}
                  draggable={false}
                />
              </div>
            ),
          )}
        </div>

        {        }
        <div
          className="flex flex-col items-center gap-3"
          style={{
            marginBottom: 30,
          }}
        >
          {bottomItems.map(
            (item) => {
              const isActive =
                activeView ===
                  item.view ||
                (
                  item.view ===
                    'setting' &&
                  isSettingsOpen
                );

              return (
                <div
                  key={item.view}
                  className={`${baseClass} ${
                    isActive
                      ? selected
                      : ''
                  }`}
                  onMouseEnter={(
                    e,
                  ) =>
                    (
                      e.currentTarget
                        .className +=
                      ` ${hoverClass}`
                    )
                  }
                  onMouseLeave={(
                    e,
                  ) => {
                    e.currentTarget
                      .className =
                      e.currentTarget.className.replace(
                        ` ${hoverClass}`,
                        '',
                      );
                  }}
                  onClick={() => {
                    if (
                      item.view ===
                      'setting'
                    ) {
                      handleSettingClick();
                    } else {
                      handleClick(
                        item.view as ViewType,
                      );
                    }
                  }}
                  title={localize(
                    item.labelKey,
                  )}
                >
                  <img
                    src={getIconSrc(
                      item,
                    )}
                    alt={localize(
                      item.labelKey,
                    )}
                    className={`${ICON} object-contain`}
                    draggable={
                      false
                    }
                  />
                </div>
              );
            },
          )}
        </div>
      </div>

      <UserProfileModal
        open={profileOpen}
        onClose={() => {
          setProfileOpen(false);
        }}
      />
    </>
  );
};

export default LeftSidebar;