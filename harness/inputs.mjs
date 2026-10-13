// Only these state and question fields reach providers. Gold and review metadata never do.
export const TIME_POLICY = 'Şimdiki an mesajın yazıldığı andır. Bugün/dün/yarın bu ana göredir. Mesaj dışında tarih veya saat yoktur; yazılmayan bilgi bilinmiyor sayılır.';
export const WRITER = 'Mesajı müşteri yazmıştır; sorulardaki müşteri bu yazardır.';
export const EVIDENCE_POLICY = 'Yalnızca mesajdaki belirli olay ve verilen kuralı değerlendir. Başka olay veya dış bilgi ekleme. Yazarın doğrudan beyanı ve kaynağı belirtilmeyen -mış ifadesi bu testte yazarın beyanıdır. Açıkça başkasına veya ekran/belgeye atfedilen iddia, iddianın söylendiğini gösterir; gerçekleştiğini tek başına doğrulamaz. Yazarın kendi açık düzeltmesi son durumu belirler. Çelişki çözülmemişse veya yalnızca olasılık/henüz gerçekleşmemiş koşul varsa sonuç belirsizdir. Geçmişe ilişkin karşıolgusal veya pişmanlık ifadelerinde olağan Türkçe çıkarımı kullan; salt yapabilirdim fiili eylemin yapılmadığını kanıtlamaz. Verilen karar kuralı önceliklidir.';
export const TASK_POLICY = {
  T2: 'Olay sorusu: Evet için olay, Hayır için olayın tersi mesajda ortaya konmalıdır; ikisi de ortaya konmuyorsa Anlaşılmıyor. Bilgi eksikliği Hayır değildir.',
  T1: 'Mesaj özelliği sorusu: halen geçerli talep veya kesin plan bu mesajda var mı? Hayır, bu özelliğin yokluğudur; müşterinin içten istemediği anlamına gelmez. İstiyorum, rica, emir, -ebilir misiniz, -erseniz sevinirim/memnun olurum ve koşullu talepler sayılır; yalnızca düşünülen, henüz kararlaştırılmamış plan kesin plan sayılmaz. Geri çekilmiş talep sayılmaz. Verilen kural yalnızca koşulsuz talep/plan sayıyorsa o kuralı uygula.'
};
export const VARIANTS = {base: text => text};
export function buildState(f,c) {
  return {mesaj:c.message, yazar:WRITER, zaman_ilkesi:TIME_POLICY, kanit_ilkesi:EVIDENCE_POLICY, gorev_ilkesi:TASK_POLICY[f.taskType], ...(f.rule ? {karar_kurali:f.rule}: {})};
}
export function stateAsText(state) {
  return Object.entries(state).map(([key,value])=>`${key.toLocaleUpperCase('tr-TR')}:\n${value}`).join('\n\n');
}
export function questionsFor(track,f,dataset,variant='base') {
  if (!VARIANTS[variant]) throw new Error(`Unsupported variant ${variant}`);
  if (track==='A') return Object.fromEntries(['P','notP'].map(k=>[k,{type:'noul',instructions:f.trackA[k],criteria:dataset.trackA.criteria}]));
  if (track==='B1') return {main:{type:'choice',instructions:f.question,criteria:dataset.mainOptions[f.taskType]}};
  if (track==='B2' && f.entity) return {entity:{type:'choice',instructions:f.entity.question,criteria:f.entity.options}};
  throw new Error(`Unsupported track ${track} for ${f.id}`);
}
export function expectedQuestions(track,setting) {
  return track==='A' ? setting==='native'?['P+notP']:['P','notP'] : [track==='B1'?'main':'entity'];
}
export function buildRequests({model,setting,track,variant='base',stateFormat='object'},f,c,dataset) {
  if (!['object','text'].includes(stateFormat)) throw new Error(`Unsupported state format ${stateFormat}`);
  const state=buildState(f,c), st=stateFormat==='text'?stateAsText(state):state, qs=questionsFor(track,f,dataset,variant);
  if (track==='A' && setting==='common') return Object.entries(qs).map(([question,q])=>({question,body:{model,state:st,questions:{[question]:q}}}));
  return [{question:Object.keys(qs).join('+'),body:{model,state:st,questions:qs}}];
}
