import {jsx as reactJsx, jsxs as reactJsxs} from 'react/jsx-runtime';
import {t} from '../../../i18n.js';
export {Fragment} from 'react/jsx-runtime';
export type {JSX} from 'react';
function text(value: unknown): unknown {return typeof value==='string'?t(value):Array.isArray(value)?value.map(text):value;}
function translate(type: unknown,props: unknown){
  if(typeof type!=='string'||!props||typeof props!=='object'||['script','style','code','pre','textarea'].includes(type))return props;
  const source=props as Record<string,unknown>;
  const result: Record<string,unknown>={...source,children:source['data-no-translate']!==undefined?source.children:text(source.children)};
  for(const key of ['title','placeholder','aria-label','alt'])if(typeof result[key]==='string')result[key]=t(result[key]);
  return result;
}
export const jsx: typeof reactJsx=(type,props,key)=>reactJsx(type,translate(type,props),key);
export const jsxs: typeof reactJsxs=(type,props,key)=>reactJsxs(type,translate(type,props),key);
