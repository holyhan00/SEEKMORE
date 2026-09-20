import { markdownThemeTokens } from '../../theme/markdownThemeTokens';

export const getCodeBlockWrapperClass = (
  theme: 'light' | 'dark',
) => `
relative z-0 isolate my-[20px] rounded-[16px] border-[0.5px] shadow-sm
${theme === 'dark'
  ? 'bg-[#1e1e1e] border-[#2f2f2f]'
  : 'bg-[#ffffff] border-[#e5e7eb]'}
`;

export const getCodeToolbarClass = (
  theme: 'light' | 'dark',
) => `
sticky z-[1]
w-full flex items-center justify-between
box-border
rounded-t-[16px]
text-[10px] font-normal
px-[10px]
pl-[30px]
py-[5px]
${theme === 'dark'
  ? 'bg-[#191919] text-[#d4d4d4]'
  : 'bg-[#ededed] text-[#4b5563]'}
`;

export const getInlineTextStyle = (
  theme: 'light' | 'dark',
) => ({
  backgroundColor:
    theme === 'dark'
      ? '#252525'
      : '#f3f4f6',
  color:
    theme === 'dark'
      ? '#f3f4f6'
      : '#111827',
  padding: '0.15em 0.4em',
  borderRadius: `${markdownThemeTokens.radius.inline}px`,
  fontFamily:
    markdownThemeTokens.font.code,
  fontSize: '12px',
  fontWeight: 400,
  fontStyle: 'normal',
  lineHeight: '18px',
});
