import { useLocalize } from '../../../localization/useLocalize';
import { listExploreSkills } from '../explore.api';
import ExploreDirectoryPage from '../shared/ExploreDirectoryPage';

export default function ExploreSkillPage({
  query,
  }: {
  query: string;

}) {
  const localize = useLocalize();

  return (
    <ExploreDirectoryPage
      heading={localize('explore.skill.directory')}
      query={query}

      loadItems={listExploreSkills}
    />
  );
}
