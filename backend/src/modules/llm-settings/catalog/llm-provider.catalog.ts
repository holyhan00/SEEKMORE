                                                                   
import type { LlmCatalogProvider } from '../contracts/llm-settings.types';

type ModelOptions = Partial<{
  toolCalling: boolean;
  imageInput: boolean;
  reasoning: boolean;
  temperature: boolean;
  recommended: boolean;
}>;

const model = (
  modelKey: string,
  displayName: string,
  apiMode: string,
  options: ModelOptions = {},
) => ({
  modelKey,
  displayName,
  apiMode,
  roles: [
    'primary' as const,
    ...(options.imageInput ? ['vision' as const] : []),
  ],
  capabilities: {
    textInput: true,
    imageInput: options.imageInput ?? false,
    textOutput: true,
    imageOutput: false,
    toolCalling: options.toolCalling ?? true,
    reasoning: options.reasoning ?? false,
    temperature: options.temperature ?? true,
    multipleImageInput: options.imageInput ?? false,
  },
  recommended: options.recommended ?? false,
  enabled: true,
});


type VisionModelOptions = Partial<{
  toolCalling: boolean;
  reasoning: boolean;
  temperature: boolean;
  recommended: boolean;
  multipleImageInput: boolean;
}>;

const visionModel = (
  modelKey: string,
  displayName: string,
  apiMode: string,
  options: VisionModelOptions = {},
) => ({
  modelKey,
  displayName,
  apiMode,
  roles: ['vision' as const],
  capabilities: {
    textInput: true,
    imageInput: true,
    textOutput: true,
    imageOutput: false,
    toolCalling: options.toolCalling ?? false,
    reasoning: options.reasoning ?? false,
    temperature: options.temperature ?? true,
    multipleImageInput: options.multipleImageInput ?? true,
  },
  recommended: options.recommended ?? false,
  enabled: true,
});


type ImageModelOptions = {
  protocol: 'openai_images' | 'gemini_image' | 'gemini_interactions_image' | 'xai_images' | 'dashscope_multimodal_image' | 'ark_images';
  recommended?: boolean;
  imageEditing?: boolean;
  imageMaskEditing?: boolean;
  maximumInputImages?: number;
  imageOutputSizes?: readonly string[];
  defaultImageOutputSize?: string;
  highImageOutputSize?: string;
  baseUrl?: string;
};

const imageModel = (
  modelKey: string,
  displayName: string,
  options: ImageModelOptions,
) => ({
  modelKey,
  displayName,
  apiMode: options.protocol,
  protocol: options.protocol,
  ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
  roles: ['image_generation' as const],
  capabilities: {
    textInput: true,
    imageInput: options.imageEditing ?? false,
    textOutput: false,
    imageOutput: true,
    toolCalling: false,
    reasoning: false,
    temperature: false,
    imageEditing: options.imageEditing ?? false,
    imageMaskEditing: options.imageMaskEditing ?? false,
    multipleImageInput: (options.maximumInputImages ?? 0) > 1,
    maximumInputImages: options.maximumInputImages ?? 1,
    ...(options.imageOutputSizes ? { imageOutputSizes: options.imageOutputSizes } : {}),
    ...(options.defaultImageOutputSize ? { defaultImageOutputSize: options.defaultImageOutputSize } : {}),
    ...(options.highImageOutputSize ? { highImageOutputSize: options.highImageOutputSize } : {}),
  },
  recommended: options.recommended ?? false,
  enabled: true,
});

   
                                                                               
                                                                              
                                                                            
   
export const LLM_PROVIDER_CATALOG = [
  {
    providerKey: 'deepseek', displayName: 'DeepSeek', protocol: 'openai_chat',
    baseUrl: 'https://api.deepseek.com', apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    docsUrl: 'https://api-docs.deepseek.com/', enabled: true, sortOrder: 10,
    models: [
      model('deepseek-v4-pro', 'DeepSeek V4 Pro', 'chat_completions', {
        recommended: true,
        reasoning: true,
        temperature: false,
      }),
      model('deepseek-v4-flash', 'DeepSeek V4 Flash', 'chat_completions', {
        reasoning: true,
        temperature: false,
      }),
    ],
  },
  {
    providerKey: 'moonshot', displayName: 'Kimi / Moonshot AI', protocol: 'openai_chat',
    baseUrl: 'https://api.moonshot.ai/v1', apiKeyUrl: 'https://platform.kimi.ai/console/api-keys',
    docsUrl: 'https://platform.kimi.ai/docs/models', enabled: true, sortOrder: 20,
    models: [
      model('kimi-k3', 'Kimi K3', 'chat_completions', {
        recommended: true,
        imageInput: true,
        reasoning: true,
        temperature: false,
      }),
      model('kimi-k2.7-code-highspeed', 'Kimi K2.7 Code Highspeed', 'chat_completions', {
        imageInput: true,
        reasoning: true,
        temperature: false,
      }),
      model('kimi-k2.7-code', 'Kimi K2.7 Code', 'chat_completions', {
        imageInput: true,
        reasoning: true,
        temperature: false,
      }),
      model('kimi-k2.6', 'Kimi K2.6', 'chat_completions', {
        imageInput: true,
        reasoning: true,
      }),
    ],
  },
  {
    providerKey: 'openai', displayName: 'OpenAI', protocol: 'openai_responses',
    baseUrl: 'https://api.openai.com/v1', apiKeyUrl: 'https://platform.openai.com/api-keys',
    docsUrl: 'https://developers.openai.com/api/docs/models', enabled: true, sortOrder: 30,
    models: [
      model('gpt-5.6-sol', 'GPT-5.6 Sol', 'responses', {
        recommended: true,
        imageInput: true,
        reasoning: true,
        temperature: false,
      }),
      model('gpt-5.6-terra', 'GPT-5.6 Terra', 'responses', {
        imageInput: true,
        reasoning: true,
        temperature: false,
      }),
      model('gpt-5.6-luna', 'GPT-5.6 Luna', 'responses', {
        imageInput: true,
        reasoning: true,
        temperature: false,
      }),
      imageModel('gpt-image-2', 'GPT Image 2', {
        protocol: 'openai_images',
        recommended: true,
        imageEditing: true,
        imageMaskEditing: true,
        maximumInputImages: 8,
        imageOutputSizes: ['1K', '2K', '4K'],
        defaultImageOutputSize: '1K',
        highImageOutputSize: '2K',
      }),
    ],
  },
  {
    providerKey: 'minimax', displayName: 'MiniMax', protocol: 'openai_chat',
    baseUrl: 'https://api.minimax.io/v1', apiKeyUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key',
    docsUrl: 'https://www.minimaxi.com/models/text/m3', enabled: true, sortOrder: 40,
    models: [
      model('MiniMax-M3', 'MiniMax M3', 'chat_completions', {
        recommended: true,
        imageInput: true,
        reasoning: true,
      }),
    ],
  },
  {
    providerKey: 'anthropic', displayName: 'Anthropic Claude', protocol: 'anthropic_messages',
    baseUrl: 'https://api.anthropic.com', apiKeyUrl: 'https://platform.claude.com/settings/keys',
    docsUrl: 'https://platform.claude.com/docs/en/about-claude/models/overview', enabled: true, sortOrder: 50,
    models: [
      model('claude-fable-5', 'Claude Fable 5', 'anthropic_messages', {
        recommended: true,
        imageInput: true,
        reasoning: true,
        temperature: false,
      }),
      model('claude-sonnet-5', 'Claude Sonnet 5', 'anthropic_messages', {
        imageInput: true,
        reasoning: true,
        temperature: false,
      }),
      model('claude-opus-5', 'Claude Opus 5', 'anthropic_messages', {
        imageInput: true,
        reasoning: true,
        temperature: false,
      }),
      model('claude-haiku-4-5', 'Claude Haiku 4.5', 'anthropic_messages', { imageInput: true }),
    ],
  },
  {
    providerKey: 'google', displayName: 'Google Gemini', protocol: 'gemini_generate_content',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/models', enabled: true, sortOrder: 60,
    models: [
      model('gemini-3.6-flash', 'Gemini 3.6 Flash', 'gemini_generate_content', {
        recommended: true,
        imageInput: true,
        reasoning: true,
      }),
      model('gemini-3.5-flash', 'Gemini 3.5 Flash', 'gemini_generate_content', {
        imageInput: true,
        reasoning: true,
      }),
      model('gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite', 'gemini_generate_content', {
        imageInput: true,
        reasoning: true,
      }),
      model('gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview', 'gemini_generate_content', {
        imageInput: true,
        reasoning: true,
      }),
      imageModel('gemini-3.1-flash-image', 'Gemini 3.1 Flash Image', {
        protocol: 'gemini_interactions_image',
        recommended: true,
        imageEditing: true,
        maximumInputImages: 14,
        imageOutputSizes: ['512', '1K', '2K', '4K'],
        defaultImageOutputSize: '1K',
        highImageOutputSize: '2K',
      }),
      imageModel('gemini-3.1-flash-lite-image', 'Gemini 3.1 Flash Lite Image', {
        protocol: 'gemini_interactions_image',
        imageEditing: true,
        maximumInputImages: 14,
        imageOutputSizes: ['1K'],
        defaultImageOutputSize: '1K',
        highImageOutputSize: '1K',
      }),
      imageModel('gemini-3-pro-image', 'Gemini 3 Pro Image', {
        protocol: 'gemini_interactions_image',
        imageEditing: true,
        maximumInputImages: 14,
        imageOutputSizes: ['1K', '2K', '4K'],
        defaultImageOutputSize: '1K',
        highImageOutputSize: '4K',
      }),
    ],
  },
  {
    providerKey: 'xai', displayName: 'xAI Grok', protocol: 'openai_responses',
    baseUrl: 'https://api.x.ai/v1', apiKeyUrl: 'https://console.x.ai/team/default/api-keys',
    docsUrl: 'https://docs.x.ai/developers/models', enabled: true, sortOrder: 70,
    models: [
      model('grok-4.5', 'Grok 4.5', 'responses', {
        recommended: true,
        imageInput: true,
        reasoning: true,
      }),
      imageModel('grok-imagine-image-quality', 'Grok Imagine Image Quality', {
        protocol: 'xai_images',
        recommended: true,
        imageEditing: true,
        maximumInputImages: 3,
        imageOutputSizes: ['1K', '2K'],
        defaultImageOutputSize: '1K',
        highImageOutputSize: '2K',
      }),
      imageModel('grok-imagine-image', 'Grok Imagine Image', {
        protocol: 'xai_images',
        imageEditing: true,
        maximumInputImages: 3,
        imageOutputSizes: ['1K', '2K'],
        defaultImageOutputSize: '1K',
        highImageOutputSize: '2K',
      }),
    ],
  },
  {
    providerKey: 'qwen', displayName: '阿里云百炼 / Qwen', protocol: 'openai_chat',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyUrl: 'https://bailian.console.aliyun.com/?apiKey=1&tab=model',
    docsUrl: 'https://help.aliyun.com/zh/model-studio/models', enabled: true, sortOrder: 80,
    models: [
      model('qwen3.8-max', 'Qwen 3.8 Max', 'chat_completions', {
        recommended: true,
        imageInput: true,
        reasoning: true,
      }),
      model('qwen3.8-max-0902', 'Qwen 3.8 Max 0902', 'chat_completions', {
        imageInput: true,
        reasoning: true,
      }),
      model('qwen3.7-plus', 'Qwen 3.7 Plus', 'chat_completions', {
        imageInput: true,
        reasoning: true,
      }),
      model('qwen3.8-flash', 'Qwen 3.8 Flash', 'chat_completions', {
        imageInput: true,
        reasoning: true,
      }),
      model('qwen3.7-max', 'Qwen 3.7 Max', 'chat_completions', {
        reasoning: true,
      }),
      model('qwen3.7-flash', 'Qwen 3.7 Flash', 'chat_completions', {
        imageInput: true,
        reasoning: true,
      }),
      model('qwen3-coder-next', 'Qwen3 Coder Next', 'chat_completions', {
        reasoning: true,
      }),
      model('qwen3-coder-plus', 'Qwen3 Coder Plus', 'chat_completions', {
        reasoning: true,
      }),
      model('qwen3-coder-flash', 'Qwen3 Coder Flash', 'chat_completions', {
        reasoning: true,
      }),
      visionModel('qwen3-vl-plus', 'Qwen3-VL Plus', 'chat_completions', {
        toolCalling: true,
        reasoning: true,
        multipleImageInput: true,
      }),
      visionModel('qwen3-vl-flash', 'Qwen3-VL Flash', 'chat_completions', {
        toolCalling: true,
        reasoning: true,
        multipleImageInput: true,
      }),
      imageModel('qwen-image-3.0-pro', 'Qwen Image 3.0 Pro', {
        protocol: 'dashscope_multimodal_image',
        recommended: true,
        imageEditing: true,
        maximumInputImages: 3,
        imageOutputSizes: ['1K', '2K'],
        defaultImageOutputSize: '1K',
        highImageOutputSize: '2K',
        baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      }),
      imageModel('qwen-image-3.0', 'Qwen Image 3.0', {
        protocol: 'dashscope_multimodal_image',
        imageEditing: true,
        maximumInputImages: 3,
        imageOutputSizes: ['1K', '2K'],
        defaultImageOutputSize: '1K',
        highImageOutputSize: '2K',
        baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      }),
      imageModel('wan2.7-image-pro', 'Wan 2.7 Image Pro', {
        protocol: 'dashscope_multimodal_image',
        imageEditing: true,
        maximumInputImages: 9,
        imageOutputSizes: ['1K', '2K', '4K'],
        defaultImageOutputSize: '2K',
        highImageOutputSize: '4K',
        baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      }),
      imageModel('wan2.7-image', 'Wan 2.7 Image', {
        protocol: 'dashscope_multimodal_image',
        imageEditing: true,
        maximumInputImages: 9,
        imageOutputSizes: ['1K', '2K'],
        defaultImageOutputSize: '2K',
        highImageOutputSize: '2K',
        baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      }),
      imageModel('qwen-image-2.0', 'Qwen Image 2.0', {
        protocol: 'dashscope_multimodal_image',
        imageEditing: true,
        maximumInputImages: 3,
        imageOutputSizes: ['1K', '2K'],
        defaultImageOutputSize: '1K',
        highImageOutputSize: '2K',
        baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      }),
      imageModel('z-image-turbo', 'Z-Image Turbo', {
        protocol: 'dashscope_multimodal_image',
        imageEditing: false,
        maximumInputImages: 1,
        imageOutputSizes: ['1K', '2K'],
        defaultImageOutputSize: '1K',
        highImageOutputSize: '2K',
        baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      }),
    ],
  },
  {
    providerKey: 'zhipu', displayName: '智谱 GLM', protocol: 'openai_chat',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKeyUrl: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys',
    docsUrl: 'https://docs.bigmodel.cn/cn/guide/models/text/glm-5.2', enabled: true, sortOrder: 90,
    models: [
      model('glm-5.2', 'GLM-5.2', 'chat_completions', {
        recommended: true,
        reasoning: true,
      }),
    ],
  },
  {
    providerKey: 'doubao', displayName: '火山方舟 / Doubao', protocol: 'openai_responses',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    docsUrl: 'https://www.volcengine.com/docs/82379/1795150', enabled: true, sortOrder: 100,
    models: [
      model('doubao-seed-2-1-pro-260628', 'Doubao Seed 2.1 Pro', 'responses', {
        recommended: true,
        imageInput: true,
        reasoning: true,
      }),
      model('doubao-seed-2-1-turbo-260628', 'Doubao Seed 2.1 Turbo', 'responses', {
        imageInput: true,
        reasoning: true,
      }),
      imageModel('doubao-seedream-5-0-pro-260628', 'Doubao Seedream 5.0 Pro', {
        protocol: 'ark_images',
        recommended: true,
        imageEditing: true,
        maximumInputImages: 14,
        imageOutputSizes: ['1K', '2K', '4K'],
        defaultImageOutputSize: '2K',
        highImageOutputSize: '4K',
      }),
      imageModel('doubao-seedream-5-0-lite-260128', 'Doubao Seedream 5.0 Lite', {
        protocol: 'ark_images',
        imageEditing: true,
        maximumInputImages: 14,
        imageOutputSizes: ['1K', '2K', '4K'],
        defaultImageOutputSize: '2K',
        highImageOutputSize: '4K',
      }),
    ],
  },
  {
    providerKey: 'mistral', displayName: 'Mistral AI', protocol: 'openai_chat',
    baseUrl: 'https://api.mistral.ai/v1', apiKeyUrl: 'https://console.mistral.ai/api-keys',
    docsUrl: 'https://docs.mistral.ai/models', enabled: true, sortOrder: 110,
    models: [
      model('mistral-medium-3-5', 'Mistral Medium 3.5', 'chat_completions', {
        recommended: true,
        imageInput: true,
        reasoning: true,
      }),
      model('mistral-small-2603', 'Mistral Small 4', 'chat_completions', {
        reasoning: true,
      }),
    ],
  },

  {
    providerKey: 'hunyuan', displayName: '腾讯混元 / Hunyuan', protocol: 'openai_chat',
    baseUrl: 'https://tokenhub.tencentmaas.com/v1',
    apiKeyUrl: 'https://console.cloud.tencent.com/lkeap/api-key',
    docsUrl: 'https://cloud.tencent.com/document/product/1823/132252', enabled: true, sortOrder: 130,
    models: [
      model('hy3', 'Tencent Hy3', 'chat_completions', {
        recommended: true,
        reasoning: true,
        temperature: false,
      }),
    ],
  },
  {
    providerKey: 'stepfun', displayName: '阶跃星辰 / StepFun', protocol: 'openai_chat',
    baseUrl: 'https://api.stepfun.com/v1',
    apiKeyUrl: 'https://platform.stepfun.com/interface-key',
    docsUrl: 'https://platform.stepfun.com/docs/zh/guides/models/overview', enabled: true, sortOrder: 140,
    models: [
      model('step-3.7-flash', 'Step 3.7 Flash', 'chat_completions', {
        recommended: true,
        imageInput: true,
        reasoning: true,
        temperature: false,
      }),
    ],
  },
  {
    providerKey: 'xiaomi', displayName: '小米 MiMo', protocol: 'openai_responses',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    apiKeyUrl: 'https://platform.xiaomimimo.com',
    docsUrl: 'https://mimo.mi.com/docs/en-US/api/model/list-models', enabled: true, sortOrder: 150,
    models: [
      model('mimo-v2.5-pro', 'MiMo V2.5 Pro', 'responses_basic_tools', {
        recommended: true,
        imageInput: true,
        reasoning: true,
        temperature: false,
      }),
      model('mimo-v2.5', 'MiMo V2.5', 'responses_basic_tools', {
        imageInput: true,
        reasoning: true,
        temperature: false,
      }),
    ],
  },
  {
    providerKey: 'longcat', displayName: '美团 LongCat', protocol: 'openai_chat',
    baseUrl: 'https://api.longcat.chat/openai/v1',
    apiKeyUrl: 'https://longcat.chat/platform',
    docsUrl: 'https://longcat.chat/platform/docs/api/chat.html', enabled: true, sortOrder: 160,
    models: [
      model('LongCat-2.0', 'LongCat 2.0', 'chat_completions', {
        recommended: true,
        reasoning: true,
      }),
    ],
  },
  {
    providerKey: 'antling', displayName: '蚂蚁百灵 / Ant Ling', protocol: 'openai_chat',
    baseUrl: 'https://api.ant-ling.com/v1',
    apiKeyUrl: 'https://chat.ant-ling.com',
    docsUrl: 'https://developer.ant-ling.com/zh-CN/docs/models/ling/', enabled: true, sortOrder: 170,
    models: [
      model('Ling-2.6-1T', 'Ling 2.6 1T', 'chat_completions', {
        recommended: true,
        reasoning: true,
        temperature: false,
      }),
      model('Ling-3.0-flash', 'Ling 3.0 Flash', 'chat_completions', {
        reasoning: true,
      }),
      model('Ring-2.6-1T', 'Ring 2.6 1T', 'chat_completions', {
        reasoning: true,
        temperature: false,
      }),
    ],
  },

  {
    providerKey: 'cohere', displayName: 'Cohere', protocol: 'openai_chat',
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    apiKeyUrl: 'https://dashboard.cohere.com/api-keys',
    docsUrl: 'https://docs.cohere.com/docs/models', enabled: true, sortOrder: 190,
    models: [
      model('command-a-plus-05-2026', 'Command A Plus (05-2026)', 'chat_completions_basic_tools', {
        recommended: true,
        imageInput: true,
        reasoning: true,
      }),
    ],
  },
  {
    providerKey: 'ai21', displayName: 'AI21 Labs', protocol: 'openai_chat',
    baseUrl: 'https://api.ai21.com/studio/v1',
    apiKeyUrl: 'https://studio.ai21.com/account/api-key',
    docsUrl: 'https://docs.ai21.com/docs/jamba-foundation-models', enabled: true, sortOrder: 200,
    models: [
      model('jamba-mini', 'Jamba Mini 2', 'chat_completions_nonstream_tools', {
        recommended: true,
      }),
      model('jamba-large', 'Jamba Large 1.7', 'chat_completions_nonstream_tools'),
    ],
  },
  {
    providerKey: 'nvidia', displayName: 'NVIDIA Nemotron', protocol: 'openai_chat',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    apiKeyUrl: 'https://build.nvidia.com/settings/api-keys',
    docsUrl: 'https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b/build', enabled: true, sortOrder: 210,
    models: [
      model('nvidia/nemotron-3-ultra-550b-a55b', 'Nemotron 3 Ultra 550B', 'chat_completions', {
        recommended: true,
        reasoning: true,
      }),
    ],
  },
] as const satisfies readonly LlmCatalogProvider[];
