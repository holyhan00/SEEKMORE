                                                                                 

import { useState } from 'react';

export function useCognitiveAgentCreateFlow() {
  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [createCognitiveOpen, setCreateCognitiveOpen] = useState(false);

  const openTypeModal = () => setTypeModalOpen(true);
  const closeTypeModal = () => setTypeModalOpen(false);

  const openCognitiveCreate = () => {
    setTypeModalOpen(false);
    setCreateCognitiveOpen(true);
  };

  const closeCognitiveCreate = () => setCreateCognitiveOpen(false);

  return {
    typeModalOpen,
    createCognitiveOpen,
    openTypeModal,
    closeTypeModal,
    openCognitiveCreate,
    closeCognitiveCreate,
  };
}
