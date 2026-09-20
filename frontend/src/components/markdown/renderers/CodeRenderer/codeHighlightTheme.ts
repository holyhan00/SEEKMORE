import type {
  CSSProperties,
} from 'react';

interface CodeHighlightPalette {
  text: string;
  comment: string;
  punctuation: string;
  keyword: string;
  string: string;
  function: string;
  type: string;
  number: string;
  property: string;
  tag: string;
  regex: string;
}

type CodeHighlightTheme = Record<
  string,
  CSSProperties
>;

const tokenTypography: CSSProperties = {
  fontWeight: 400,
  fontStyle: 'normal',
  textDecoration: 'none',
  textShadow: 'none',
};

const createCodeHighlightTheme = (
  palette: CodeHighlightPalette,
): CodeHighlightTheme => ({
  'code[class*="language-"]': {
    ...tokenTypography,
    color: palette.text,
    background: 'transparent',
    fontFamily: 'inherit',
    textAlign: 'left',
    whiteSpace: 'pre',
    wordSpacing: 'normal',
    wordBreak: 'normal',
    wordWrap: 'normal',
    tabSize: 2,
    hyphens: 'none',
  },
  'pre[class*="language-"]': {
    ...tokenTypography,
    color: palette.text,
    background: 'transparent',
    fontFamily: 'inherit',
    textAlign: 'left',
    whiteSpace: 'pre',
    wordSpacing: 'normal',
    wordBreak: 'normal',
    wordWrap: 'normal',
    tabSize: 2,
    hyphens: 'none',
  },
  comment: {
    ...tokenTypography,
    color: palette.comment,
  },
  prolog: {
    ...tokenTypography,
    color: palette.comment,
  },
  doctype: {
    ...tokenTypography,
    color: palette.comment,
  },
  cdata: {
    ...tokenTypography,
    color: palette.comment,
  },
  punctuation: {
    ...tokenTypography,
    color: palette.punctuation,
  },
  namespace: {
    ...tokenTypography,
    color: palette.type,
    opacity: 0.85,
  },
  property: {
    ...tokenTypography,
    color: palette.property,
  },
  tag: {
    ...tokenTypography,
    color: palette.tag,
  },
  constant: {
    ...tokenTypography,
    color: palette.number,
  },
  symbol: {
    ...tokenTypography,
    color: palette.number,
  },
  deleted: {
    ...tokenTypography,
    color: palette.tag,
  },
  boolean: {
    ...tokenTypography,
    color: palette.number,
  },
  number: {
    ...tokenTypography,
    color: palette.number,
  },
  selector: {
    ...tokenTypography,
    color: palette.property,
  },
  'attr-name': {
    ...tokenTypography,
    color: palette.property,
  },
  string: {
    ...tokenTypography,
    color: palette.string,
  },
  char: {
    ...tokenTypography,
    color: palette.string,
  },
  builtin: {
    ...tokenTypography,
    color: palette.type,
  },
  inserted: {
    ...tokenTypography,
    color: palette.string,
  },
  operator: {
    ...tokenTypography,
    color: palette.punctuation,
  },
  entity: {
    ...tokenTypography,
    color: palette.type,
    cursor: 'help',
  },
  url: {
    ...tokenTypography,
    color: palette.string,
  },
  variable: {
    ...tokenTypography,
    color: palette.text,
  },
  atrule: {
    ...tokenTypography,
    color: palette.keyword,
  },
  'attr-value': {
    ...tokenTypography,
    color: palette.string,
  },
  function: {
    ...tokenTypography,
    color: palette.function,
  },
  'class-name': {
    ...tokenTypography,
    color: palette.type,
  },
  keyword: {
    ...tokenTypography,
    color: palette.keyword,
  },
  regex: {
    ...tokenTypography,
    color: palette.regex,
  },
  important: {
    ...tokenTypography,
    color: palette.keyword,
  },
  bold: {
    ...tokenTypography,
  },
  italic: {
    ...tokenTypography,
  },
});

export const codeHighlightLight =
  createCodeHighlightTheme({
    text: '#2B2F36',
    comment: '#8A929E',
    punctuation: '#69717D',
    keyword: '#7657C8',
    string: '#397B58',
    function: '#356FA8',
    type: '#39758C',
    number: '#A26445',
    property: '#47745F',
    tag: '#9A5E6B',
    regex: '#9B684F',
  });

export const codeHighlightDark =
  createCodeHighlightTheme({
    text: '#D4D7DC',
    comment: '#747C87',
    punctuation: '#9BA2AC',
    keyword: '#B7A0D9',
    string: '#91B99A',
    function: '#8FAFD2',
    type: '#87B8C2',
    number: '#D2A184',
    property: '#8CB6A7',
    tag: '#C9A0A9',
    regex: '#C8A88E',
  });
