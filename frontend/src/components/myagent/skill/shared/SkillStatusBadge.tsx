import { useLocalize } from '../../../../localization/useLocalize';
                                                                    
import type {
  SkillSecurityState,
  SkillStatus,
} from '../types/skill.types';

export default function SkillStatusBadge({
  status,
  securityState,
  deletedAt,
}: {
  status: SkillStatus;
  securityState?: SkillSecurityState;
  deletedAt?: string | null;
}) {
  const localize = useLocalize();
  const blocked =
    securityState === 'QUARANTINED' ||
    securityState === 'BLOCKED';

  const deleted = Boolean(deletedAt);

  return (
    <span
      className={`rounded-full px-[5px] py-[2px] text-[10px] font-medium ${
        deleted
          ? 'bg-[#EF4444] text-[#FFFFFF]'
          : blocked
            ? 'bg-[#EF4444] text-[#FFFFFF]'
            : status === 'ACTIVE'
              ? 'bg-action-primary text-[#FFFFFF]'
              : status === 'DRAFT'
                ? 'bg-[#3B82F6] text-[#FFFFFF]'
                : 'bg-[#6B7280] text-[#FFFFFF]'
      }`}
    >
      {deleted
        ? localize('skills.status.deleted')
        : blocked && securityState
          ? localize(`skills.security.${securityState}`)
          : localize(`skills.status.${status}`)}
    </span>
  );
}