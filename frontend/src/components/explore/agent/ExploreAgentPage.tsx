import { useLocalize } from '../../../localization/useLocalize';
import { listExploreAgents } from '../explore.api';
import ExploreDirectoryPage from '../shared/ExploreDirectoryPage';

export default function ExploreAgentPage({
  query,
  }: {
  query: string;

}) {
  const localize = useLocalize();

  return (
    <ExploreDirectoryPage
      heading={localize('explore.agent.directory')}
      query={query}

      loadItems={listExploreAgents}
    />
  );
}
