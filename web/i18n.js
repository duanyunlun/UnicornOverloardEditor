export const LANGUAGES=['zh-CN','en-US','ja-JP'];
let language='zh-CN',catalog,lookup=new Map(),phraseIndex=new Map();
export function getLanguage(){return language;}
export function presetDisplayName(preset){
  if(preset.id<0)return preset.symbol;
  const classes=[...new Set((preset.references||[]).map(reference=>reference.class_symbol).filter(Boolean))];
  const context=classes.length?classes.map(t).join(' / '):t((preset.lines||[]).find(line=>line.skill_name)?.skill_name||'');
  return `${context?context+' · ':''}${t('战术预设')} #${preset.id}`;
}
export function localizedName(row,id=row?.[0]){return row?.[{'zh-CN':3,'en-US':1,'ja-JP':2}[language]]||t(row?.[2]||row?.[3]||row?.[1])||`ID ${id}`;}
const sourceText=new WeakMap(),sourceAttributes=new WeakMap();
export function translateDom(root){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode;if(node.parentElement?.closest('script,style,pre,code,textarea,[data-no-translate]'))continue;const source=sourceText.get(node);if(!source||node.nodeValue!==source.translated)sourceText.set(node,{original:node.nodeValue,translated:node.nodeValue});const entry=sourceText.get(node);node.nodeValue=t(entry.original);entry.translated=node.nodeValue;}
  for(const node of root.querySelectorAll('[placeholder],[title],[aria-label]')){if(!sourceAttributes.has(node))sourceAttributes.set(node,{});const original=sourceAttributes.get(node);for(const key of ['placeholder','title','aria-label'])if(node.hasAttribute(key)){original[key]??=node.getAttribute(key);node.setAttribute(key,t(original[key]));}}
}
export function setLanguage(value){if(!LANGUAGES.includes(value))throw Error('Unsupported language');language=value;if(catalog)configureTranslations(catalog);}
export function configureTranslations(data){
  catalog=data;lookup=new Map();const column=LANGUAGES.indexOf(language);
  const add=translations=>{const target=translations[column]||translations.find(Boolean);if(!target)return;for(const source of translations)if(source)lookup.set(source,target);};
  const locales=data.locales||{};for(const key of Object.keys(locales['en-US']||{}))add([key,locales['en-US'][key],locales['ja-JP']?.[key]]);
  for(const entry of data.uiTranslations||[])add(entry);
  for(const filename of ['class.txt','name.txt','skill.txt','item.txt']){
    for(const line of (data.info[filename]||'').replace(/^\uFEFF/,'').split(/\r?\n/)){if(!/^\d+\t/.test(line))continue;const row=line.split('\t');if(filename==='class.txt'&&Number(row[0])>=74)continue;add([row[3],row[1],row[2]]);}
  }
  for(const entry of data.nameTranslations||[]){add(entry.values);const target=entry.values[column]||entry.values.find(Boolean);for(const alias of entry.aliases||[])if(alias)lookup.set(alias,target);}
  phraseIndex=new Map();for(const entry of [...lookup].filter(([source,target])=>source!==target&&source.length>1).sort((left,right)=>right[0].length-left[0].length)){const first=entry[0][0];if(!phraseIndex.has(first))phraseIndex.set(first,[]);phraseIndex.get(first).push(entry);}
}
export function t(value){
  if(typeof value!=='string'||!value)return value;
  const trimmed=value.trim();if(lookup.has(trimmed))return value.replace(trimmed,lookup.get(trimmed));
  let result='',position=0;
  while(position<value.length){let match;for(const entry of phraseIndex.get(value[position])||[]){if(!value.startsWith(entry[0],position))continue;const first=entry[0][0],last=entry[0].at(-1);if(/[A-Za-z]/.test(first)&&position>0&&/[A-Za-z_]/.test(value[position-1]))continue;if(/[A-Za-z]/.test(last)&&/[A-Za-z_]/.test(value[position+entry[0].length]||''))continue;match=entry;break;}if(match){result+=match[1];position+=match[0].length;}else result+=value[position++];}
  return result;
}
