// 火災保険 有責・無責の判定ロジック（画面に依存しない部分）
// ブラウザでは window.FireJudge、Node.js では require / import で使う。
(function (root) {
  'use strict';

  // 事故原因 → 対応する補償（入力項目のキー）
  const CAUSES = {
    fire:{cov:'cFire',name:'火災'}, lightning:{cov:'cFire',name:'落雷'}, explosion:{cov:'cFire',name:'破裂・爆発'},
    wind:{cov:'cWind',name:'風災・雹災・雪災'}, flood:{cov:'cFlood',name:'水災'}, water:{cov:'cWater',name:'水濡れ'},
    impact:{cov:'cImpact',name:'物体の落下・飛来・衝突'}, riot:{cov:'cRiot',name:'騒擾・集団行動等'},
    theft:{cov:'cTheft',name:'盗難'}, breakage:{cov:'cBreak',name:'破損・汚損'},
    quake:{cov:null,name:'地震・噴火・津波'}, wear:{cov:null,name:'経年劣化'}
  };

  // 原因ごとの追加質問
  const SUBQ = {
    fire:[{id:'qQuakeFire',type:'yn',text:'地震・噴火・津波が原因で起きた火災ですか？'}],
    lightning:[], explosion:[{id:'qQuakeFire',type:'yn',text:'地震・噴火・津波が原因で起きた破裂・爆発ですか？'}],
    wind:[{id:'qWindExt',type:'yn',text:'屋根・外壁・窓など建物の外側が、風・雹・雪で破損していますか？（外側に破損がなく、すき間から雨や雪が吹き込んだだけの場合は「いいえ」）'}],
    flood:[{id:'qFlood',type:'sel',text:'浸水・損害の程度',opts:[
      ['floor','床上浸水'],['45','地盤面から45cmを超える浸水'],['30','損害額が再調達価額の30%以上'],['none','いずれにも当たらない（床下浸水など）']]}],
    water:[{id:'qWaterSelf',type:'yn',text:'損害は給排水設備そのもの（配管・給湯器など）の修理費だけですか？'}],
    impact:[{id:'qImpactCar',type:'yn',text:'ぶつかったのは契約者・被保険者自身が運転する車両ですか？'}],
    riot:[], theft:[{id:'qPolice',type:'yn',text:'警察へ被害届を提出していますか？'}],
    breakage:[{id:'qCosmetic',type:'yn',text:'機能に支障のない外観上の損傷（すり傷・かき傷・塗装のはがれ等）だけですか？'}],
    quake:[], wear:[]
  };

  const num = v => Math.max(0, parseFloat(v) || 0);
  const man = v => (Math.round(v*10)/10).toLocaleString('ja-JP') + '万円';
  const date = v => v ? new Date(v + 'T00:00:00') : null;

  // input: 入力欄と同じキーを持つオブジェクト。sub: 追加質問の回答（{qWindExt:'y'} など）
  // 戻り値: {verdict:'ok'|'ng'|'warn', checks:[{t,s,d,c,miss}], pay, calc}
  //   d: 窓口向けの説明 / c: お客様向けの文（不適合・要確認のとき） / miss: 入力不足
  function judge(input, sub) {
    const inp = Object.assign({cFire:true}, input), S = sub || {};
    const c = inp.cause, cause = CAUSES[c];
    const checks = [];
    const add = (t,s,d,cust,miss)=>checks.push({t,s,d,c:cust||'',miss:!!miss});

    // 1 請求期限
    const acc = date(inp.accDate), claim = date(inp.claimDate);
    if(!acc || !claim) add('請求期限','warn','事故発生日と請求日を入力してください。','',true);
    else{
      const lim = new Date(acc); lim.setFullYear(lim.getFullYear()+3);
      if(claim < acc) add('請求期限','warn','請求日が事故発生日より前になっています。','',true);
      else if(claim > lim) add('請求期限','ng','事故から3年を過ぎており、保険金請求権が時効で消滅しています（保険法第95条）。',
        'ご事故から3年を経過しているため、保険金をご請求いただける期間を過ぎています。');
      else add('請求期限','ok','事故から3年以内の請求です。');
    }

    // 2 保険期間
    const ps = date(inp.pStart), pe = date(inp.pEnd);
    if(!acc || !ps || !pe) add('保険期間','warn','保険期間と事故発生日を入力してください。','',true);
    else if(acc < ps || acc >= pe) add('保険期間','ng','事故発生日が保険期間の外です。',
      'ご事故の発生日が、ご契約の保険期間の外となっています。');
    else add('保険期間','ok','保険期間中の事故です。');

    // 3 保険の対象
    const obj = inp.object, objName = obj==='building'?'建物':'家財';
    const insured = obj==='building' ? !!inp.tBuilding : !!inp.tContents;
    if(insured) add('保険の対象','ok',`${objName}は保険の対象に含まれています。`);
    else add('保険の対象','ng',`${objName}は保険の対象に含まれていません。`,
      `ご契約の保険の対象に、${objName}が含まれていません。`);

    // 4 免責事由
    if(inp.exIntent) add('免責事由','ng','故意・重大な過失・法令違反による損害は支払対象外です。',
      '故意・重大な過失・法令違反による損害は、お支払いの対象外となります。');
    else if(inp.exWar) add('免責事由','ng','戦争・内乱・核燃料物質等による損害は支払対象外です。',
      '戦争・内乱・核燃料物質等による損害は、お支払いの対象外となります。');
    else if(inp.exWear || c==='wear') add('免責事由','ng','経年劣化・さび・腐食・虫食い等による損害は、偶然な事故ではないため支払対象外です。',
      '経年劣化・さび・腐食・虫食い等による損害は、偶然な事故によるものではないため、お支払いの対象外となります。');
    else add('免責事由','ok','該当する免責事由はありません。');

    // 5 補償範囲
    let isQuake = c==='quake';
    const quakeFire = (c==='fire'||c==='explosion') && S.qQuakeFire==='y';
    if(quakeFire) isQuake = true;

    if(c==='wear'){
      add('補償範囲','na','経年劣化はどの補償にも当たりません。');
    }else if(isQuake){
      // 地震保険はこのツールの対象外。火災保険では補償されないことだけを判定する
      const toQuake = '地震保険の加入状況を確認し、地震保険の窓口へご案内ください（地震保険はこのツールの対象外）。';
      const custQuake = '地震保険にご加入の場合は、地震保険について別途ご案内いたします。';
      if(c==='fire' && quakeFire) add('補償範囲','ng',
        '地震・噴火・津波による火災は、火災保険では補償されません。半焼以上であれば地震火災費用保険金（保険金額の5%程度）が支払われる場合があります。'+toQuake,
        '地震・噴火・津波を原因とする火災による損害は、火災保険では補償されません。なお、損害の程度によっては地震火災費用保険金をお支払いできる場合があります。'+custQuake);
      else add('補償範囲','ng',
        '地震・噴火・津波による損害は、火災保険では補償されません。'+toQuake,
        '地震・噴火・津波を原因とする損害は、火災保険では補償されません。'+custQuake);
    }else{
      const on = !!inp[cause.cov];
      if(on) add('補償範囲','ok',`「${cause.name}」の補償が付帯されています。`);
      else add('補償範囲','ng',`「${cause.name}」の補償が付帯されていません。`,
        `ご契約に「${cause.name}」の補償が付帯されていません。`);
    }

    // 6 原因別の支払基準（お客様向けの文は、不適合なら理由、要確認なら確認が必要な点）
    const crit = (s,d,cust)=>add('支払基準',s,d,cust);
    const yn = id => S[id] || '';
    if(c==='fire'||c==='explosion'){ if(yn('qQuakeFire')==='') crit('warn','地震等との因果関係が未確認です。地震後の火災は消防の出火原因調査を確認します。',
        '出火の原因（地震・噴火・津波との関係の有無）');
      else if(yn('qQuakeFire')==='n') crit('ok','地震等によらない火災・破裂爆発です。'); }
    if(c==='wind'){ if(yn('qWindExt')==='y') crit('ok','風・雹・雪による外部の破損が確認できます。');
      else if(yn('qWindExt')==='n') crit('ng','建物外部に破損がない吹込み・雨漏りは、風災の対象外です（経年による雨漏りとして扱われます）。',
        '建物の外側に風・雹・雪による破損がない場合、すき間からの吹き込みや雨漏りによる損害は、風災の補償の対象外となります。');
      else crit('warn','外部の破損の有無を現地調査で確認する必要があります。',
        '建物の外側（屋根・外壁・窓など）に、風・雹・雪による破損があるかどうか'); }
    if(c==='flood'){ const v=yn('qFlood'); if(v==='none') crit('ng','床上浸水・地盤面から45cm超・損害30%以上のいずれにも当たらず、水災の支払基準を満たしません。',
        '浸水の程度が、水災の補償のお支払い基準（床上浸水、地盤面から45cmを超える浸水、または損害が建物の価額の30%以上）に達していません。');
      else if(v) crit('ok','水災の支払基準を満たしています（'+({floor:'床上浸水','45':'地盤面から45cm超の浸水','30':'損害30%以上'})[v]+'）。');
      else crit('warn','浸水の高さ・損害割合を確認する必要があります。',
        '浸水の高さ、または損害の程度'); }
    if(c==='water'){ if(yn('qWaterSelf')==='y') crit('ng','給排水設備そのものの修理費は水濡れ補償の対象外です。水が漏れて生じた床・壁・家財の損害が対象です。',
        '給排水設備そのものの修理費用は、水濡れの補償の対象外となります（漏れた水によって生じた床・壁・家財の損害が対象です）。');
      else if(yn('qWaterSelf')==='n') crit('ok','漏水によって生じた建物・家財の損害です。');
      else crit('warn','損害が設備自体か、漏水による周囲の損害かを確認する必要があります。',
        '損害が給排水設備そのものか、漏れた水による床・壁・家財の損害か'); }
    if(c==='impact'){ if(yn('qImpactCar')==='y') crit('ng','契約者・被保険者が運転する車両による衝突は、多くの約款で対象外です（自動車保険で対応）。',
        'ご契約者様・被保険者様ご自身が運転する車両による衝突は、お支払いの対象外となります。');
      else if(yn('qImpactCar')==='n') crit('ok','第三者の車両・飛来物などによる損害です。');
      else crit('warn','衝突した物・車両の運転者を確認する必要があります。',
        'ぶつかった物や車両と、その運転者'); }
    if(c==='theft'){ if(yn('qPolice')==='y') crit('ok','警察への被害届が提出済みです。');
      else if(yn('qPolice')==='n') crit('warn','警察への被害届が必要です。届出がないと支払われません。',
        '警察への被害届のご提出（保険金のご請求には、警察への届出が必要です）');
      else crit('warn','被害届の提出状況を確認する必要があります。',
        '警察への被害届のご提出状況'); }
    if(c==='breakage'){ if(yn('qCosmetic')==='y') crit('ng','機能に支障のない外観上の損傷は、破損・汚損補償の対象外です。',
        '機能に支障のない、すり傷や塗装のはがれなど外観上の損傷は、破損・汚損の補償の対象外となります。');
      else if(yn('qCosmetic')==='n') crit('ok','機能に支障のある破損・汚損です。');
      else crit('warn','機能への支障の有無を確認する必要があります。',
        '損傷によって、機能に支障が出ているかどうか'); }

    // 7 自己負担額と支払額
    const loss = num(inp.loss), ded = num(inp.deduct), sum = num(inp.sumIns);
    let pay = null, calc = '';
    if(isQuake || c==='wear'){
      add('支払額の算定','na','支払額は算定しません。');
    }else if(loss<=0){
      add('支払額の算定','warn','損害額を入力してください。','',true);
    }else if(c==='wind' && inp.windMode==='franchise'){
      if(loss<20){ add('支払額の算定','ng','損害額が20万円未満のため、風災の支払条件（20万円以上）を満たしません。',
        '損害額が、ご契約の風災の補償のお支払い条件（損害額20万円以上）に達していません。'); pay=0; }
      else { pay=Math.min(loss, sum||loss); calc=`損害額 ${man(loss)}（20万円以上のため全額）`; add('支払額の算定','ok','損害額が20万円以上のため、損害額の全額が対象です。'); }
    }else if(loss<=ded){
      add('支払額の算定','ng',`損害額 ${man(loss)} が免責金額 ${man(ded)} 以下のため、支払額は0円です。`,
        '損害額がご契約の免責金額（自己負担額）以下となるため、お支払いする保険金はございません。'); pay=0;
    }else{
      pay = loss-ded; calc = `損害額 ${man(loss)} − 免責金額 ${man(ded)}`;
      if(sum>0 && pay>sum){ pay=sum; calc+=`（保険金額 ${man(sum)} が上限）`; }
      add('支払額の算定','ok','免責金額を差し引いた額が支払対象です。');
    }

    const hasNg = checks.some(x=>x.s==='ng'), hasWarn = checks.some(x=>x.s==='warn');
    const verdict = hasNg ? 'ng' : hasWarn ? 'warn' : 'ok';
    return {verdict, checks, pay, calc};
  }

  // お客様向けの説明文（メール・手紙の本文。挨拶・署名・金額は入れない）
  // 戻り値: {text, missing} 入力不足のときは text が空で missing が true
  const jpDate = v => { const [y,m,d] = String(v).split('-'); return `${y}年${+m}月${+d}日`; };
  function explain(input, sub, result) {
    const r = result || judge(input, sub);
    if(r.checks.some(x=>x.miss)) return {text:'', missing:true};
    const cause = CAUSES[input.cause], objName = input.object==='building' ? '建物' : '家財';
    const EVENT = {water:'水濡れ事故', riot:'騒擾・集団行動等による破壊行為', breakage:'不測かつ突発的な事故（破損・汚損）'};
    const reasonName = EVENT[input.cause] || cause.name;

    const p1 = `${jpDate(input.accDate)}に発生した${reasonName}による${objName}の損害について、ご契約内容をもとに確認いたしました。`;
    let p2, p3, p4 = 'なお、最終的なお支払いの可否は、保険会社による損害調査の結果をもって決定いたします。';
    const list = s => r.checks.filter(x=>x.s===s && x.c).map(x=>'・'+x.c).join('\n');

    if(r.verdict==='ok'){
      p2 = '現時点では、保険金のお支払い対象となる見込みです。';
      p3 = `ご契約の「${cause.name}」の補償の対象となる事故と考えられます。`;
      p4 += 'お支払い額につきましても、損害調査の結果により決まります。';
    }else if(r.verdict==='ng'){
      p2 = '誠に恐れ入りますが、現時点では、保険金のお支払い対象とならない見込みです。';
      p3 = '理由は次のとおりです。\n' + list('ng');
    }else{
      p2 = 'お支払いの対象となるかどうかは、次の点を確認したうえで、あらためてご案内いたします。';
      p3 = list('warn');
    }
    return {text:[p1,p2,p3,p4].join('\n\n'), missing:false};
  }

  // 架空の事例（請求日は画面側で「今日」を入れる）
  const BASE = {pStart:'2025-04-01',pEnd:'2030-04-01',tBuilding:true,tContents:true,cWind:true,cFlood:false,cWater:true,cImpact:true,cRiot:true,cTheft:true,cBreak:false,
    sumIns:2000,deduct:5,windMode:'deduct',exIntent:false,exWear:false,exWar:false};
  const SAMPLES = [
    {name:'台風で屋根瓦が飛散', v:{accDate:'2026-09-20',object:'building',cause:'wind',loss:45}, s:{qWindExt:'y'}},
    {name:'古い屋根からの雨漏り', v:{accDate:'2026-10-02',object:'building',cause:'wind',loss:30,exWear:true}, s:{qWindExt:'n'}},
    {name:'豪雨で床下浸水', v:{accDate:'2026-07-10',object:'building',cause:'flood',loss:80,cFlood:true}, s:{qFlood:'none'}},
    {name:'子どもがテレビを倒した', v:{accDate:'2026-10-15',object:'contents',cause:'breakage',loss:12,cBreak:true}, s:{qCosmetic:'n'}},
    {name:'空き巣被害', v:{accDate:'2026-10-28',object:'contents',cause:'theft',loss:25}, s:{qPolice:''}},
    {name:'地震で外壁にひび', v:{accDate:'2026-08-03',object:'building',cause:'quake',loss:120}, s:{}}
  ];

  // ---- 利用ログ（成功の数字「案内の訂正件数」を数えるため。個人情報は記録しない） ----
  const VERDICT_JA = {ok:'有責', ng:'無責', warn:'要確認'};
  const pad = n => String(n).padStart(2,'0');
  const stamp = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

  // 入力と判定結果から記録1行を作る
  function makeLogEntry(input, result, now) {
    const d = now || new Date();
    const r = result;
    return {
      id: d.getTime().toString(36) + Math.random().toString(36).slice(2, 7),
      recordedAt: stamp(d),
      accDate: input.accDate || '',
      cause: (CAUSES[input.cause] || {}).name || '',
      object: input.object==='building' ? '建物' : '家財',
      verdict: VERDICT_JA[r.verdict],
      pay: r.verdict!=='ng' && r.pay!=null ? r.pay : null,
      final: ''
    };
  }

  // 案内の訂正：有責↔無責の食い違いだけを「あり」とする。要確認は数えない
  function correction(e) {
    if(!e.final) return '未入力';
    if(e.verdict==='要確認') return '対象外';
    return e.verdict!==e.final ? 'あり' : 'なし';
  }

  function summarize(entries) {
    return {
      total: entries.length,
      withFinal: entries.filter(e=>e.final).length,
      corrections: entries.filter(e=>correction(e)==='あり').length
    };
  }

  // Excel で文字化けしない CSV（BOM 付き UTF-8、CRLF 改行）
  const LOG_COLUMNS = ['記録日時','事故発生日','事故の原因','損害を受けたもの','窓口の見込み','支払見込額（万円）','保険会社の最終判断','案内の訂正'];
  function toCSV(entries) {
    const q = v => { const s = v==null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; };
    const rows = entries.map(e => [e.recordedAt, e.accDate, e.cause, e.object, e.verdict, e.pay==null?'':e.pay, e.final||'未入力', correction(e)]);
    return '﻿' + [LOG_COLUMNS, ...rows].map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
  }

  const api = {CAUSES, SUBQ, BASE, SAMPLES, judge, explain, man, makeLogEntry, correction, summarize, toCSV, LOG_COLUMNS};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FireJudge = api;
})(typeof window !== 'undefined' ? window : globalThis);
