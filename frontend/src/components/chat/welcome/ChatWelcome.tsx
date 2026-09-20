import { resolveAssetUrl } from '../../../utils/asset-url';
import { useLocalize } from '../../../localization/useLocalize';
                                                       

import ChatWelcomeActionButton
  from './ChatWelcomeActionButton';

import {
  CHAT_WELCOME_ACTIONS,
  CHAT_WELCOME_GREETING_KEY,
  type ChatWelcomeAction,
} from './chat-welcome.config';

export default function ChatWelcome({
    onSelectAction,
}: {

  onSelectAction: (
    action: ChatWelcomeAction,
  ) => void;
}) {
  const localize = useLocalize();
  return (
    <div
      className="
        pointer-events-none
        absolute
        left-0
        right-0
        top-0
        z-20
        flex
        justify-center
        pt-[60px]
      "
    >
      <div
        className="
          pointer-events-auto
          flex
          w-[85%]
          max-w-[720px]
          flex-col
          items-center
          text-center
        "
      >
        <img
          src={resolveAssetUrl('/logo.svg')}
          alt="SEEKMORE"
          draggable={false}
          className="
            h-[28px]
            w-auto
            select-none
            brightness-0
            dark:invert
          "
        />

        <div
          className={`
            mt-[10px]
            text-[15px]
            font-medium
            ${
              'text-[#252525]/70 dark:text-[#ffffff]/70'
            }
          `}
        >
          {localize(CHAT_WELCOME_GREETING_KEY)}
        </div>

        <div
          className="
            mt-[24px]
            flex
            w-full
            max-w-[680px]
            flex-wrap
            justify-center
            gap-[10px]
          "
        >
          {CHAT_WELCOME_ACTIONS.map(
            (action) => (
              <ChatWelcomeActionButton
                key={action.id}
                label={localize(action.labelKey)}

                onClick={() =>
                  onSelectAction({
                    id: action.id,
                    label: localize(action.labelKey),
                    prompt: localize(action.promptKey),
                  })
                }
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
}
