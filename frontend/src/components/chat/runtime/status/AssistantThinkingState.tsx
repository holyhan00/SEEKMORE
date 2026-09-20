import { useLocalize } from '../../../../localization/useLocalize';
import { LoaderCircle } from 'lucide-react';

export default function AssistantThinkingState({
  label,
}: {
  label?: string;
}) {
  const localize = useLocalize();
  return (
    <div
      className="flex min-h-7 items-center gap-2 text-sm text-neutral-500"
      role="status"
      aria-live="polite"
    >
      <LoaderCircle
        size={15}
        className="animate-spin"
        aria-hidden="true"
      />

      <span>{label ?? localize('assistant.thinking')}</span>
    </div>
  );
}