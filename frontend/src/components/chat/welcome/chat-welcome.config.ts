export type ChatWelcomeActionId =
  | 'presentation'
  | 'game'
  | 'pet-gif'
  | 'blender'
  | 'github'
  | 'image'
  | 'music'
  | 'todo'
  | 'automation';

export type ChatWelcomeAction = {
  id: ChatWelcomeActionId;
  label: string;
  prompt: string;
};

export type ChatWelcomeActionConfig = {
  id: ChatWelcomeActionId;
  labelKey: string;
  promptKey: string;
};

export const CHAT_WELCOME_GREETING_KEY = 'welcome.heading';

export const CHAT_WELCOME_ACTIONS: ChatWelcomeActionConfig[] = [
  { id: 'presentation', labelKey: 'welcome.presentation.label', promptKey: 'welcome.presentation.prompt' },
  { id: 'game', labelKey: 'welcome.game.label', promptKey: 'welcome.game.prompt' },
  { id: 'pet-gif', labelKey: 'welcome.petGif.label', promptKey: 'welcome.petGif.prompt' },
  { id: 'blender', labelKey: 'welcome.blender.label', promptKey: 'welcome.blender.prompt' },
  { id: 'github', labelKey: 'welcome.github.label', promptKey: 'welcome.github.prompt' },
  { id: 'image', labelKey: 'welcome.image.label', promptKey: 'welcome.image.prompt' },
  { id: 'music', labelKey: 'welcome.music.label', promptKey: 'welcome.music.prompt' },
  { id: 'todo', labelKey: 'welcome.priceWatch.label', promptKey: 'welcome.priceWatch.prompt' },
  { id: 'automation', labelKey: 'welcome.automation.label', promptKey: 'welcome.automation.prompt' },
];
