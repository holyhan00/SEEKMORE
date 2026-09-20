                                                                     

import AutomationCard from './AutomationCard';
import { useAnchoredAutomations } from './automation.store';

export default function AutomationMessageCards({
  conversationId,
  anchorMessageId,
  }: {
  conversationId: string;
  anchorMessageId: string;

}) {
  const anchored = useAnchoredAutomations(
    conversationId,
    anchorMessageId,
  );

  if (!anchored.length) return null;

  return (
    <div
      className="
        w-full
        min-w-0
        max-w-full
        flex
        flex-col
        gap-[10px]
        mb-[10px]
      "
    >
      {anchored.map((automation) => (
        <AutomationCard
          key={automation.id}
          automation={automation}

        />
      ))}
    </div>
  );
}