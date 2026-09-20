import { useLocalize } from '../../../localization/useLocalize';
type BranchSnapshotBoundaryProps = {
  
};

export default function BranchSnapshotBoundary(_props: BranchSnapshotBoundaryProps) {
  const localize = useLocalize();
  return (
    <div
      role="separator"
      aria-label={localize('chat.branch.startHere')}
      className="my-[10px] flex w-full items-center gap-[10px] text-[8px] text-[#898989]"
    >
      <span className="h-px flex-1 bg-current opacity-40" />
      <span className="shrink-0">{localize('chat.branch.startHere')}</span>
      <span className="h-px flex-1 bg-current opacity-40" />
    </div>
  );
}
