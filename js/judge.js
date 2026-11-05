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
    quake:{cov:'cQuake',name:'地震・噴火・津波'}, wear:{cov:null,name:'経年劣化'}
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
    quake:[{id:'qQuakeGrade',type:'sel',text:'地震保険の損害区分（認定見込み）',opts:[
      ['full','全損'],['major','大半損'],['minor','小半損'],['partial','一部損'],['none','一部損に満たない']]}],
    wear:[]
  };

  const QUAKE_RATE = {full:[1,'全損 100%'],major:[.6,'大半損 60%'],minor:[.3,'小半損 30%'],partial:[.05,'一部損 5%'],none:[0,'']};

  const num = v => Math.max(0, parseFloat(v) || 0);
  const man = v => (Math.round(v*10)/10).toLocaleString('ja-JP') + '万円';
  const date = v => v ? new Date(v + 'T00:00:00') : null;

  // input: 入力欄と同じキーを持つオブジェクト。sub: 追加質問の回答（{qWindExt:'y'} など）
  // 戻り値: {verdict:'ok'|'ng'|'warn', checks:[{t,s,d}], pay, calc, isQuake}
  function judge(input, sub) {
    const inp = Object.assign({cFire:true}, input), S = sub || {};
    const c = inp.cause, cause = CAUSES[c];
    const checks = [];
    const add = (t,s,d)=>checks.push({t,s,d});

    // 1 請求期限
    const acc = date(inp.accDate), claim = date(inp.claimDate);
    if(!acc || !claim) add('請求期限','warn','事故発生日と請求日を入力してください。');
    else{
      const lim = new Date(acc); lim.setFullYear(lim.getFullYear()+3);
      if(claim < acc) add('請求期限','warn','請求日が事故発生日より前になっています。');
      else if(claim > lim) add('請求期限','ng','事故から3年を過ぎており、保険金請求権が時効で消滅しています（保険法第95条）。');
      else add('請求期限','ok','事故から3年以内の請求です。');
    }

    // 2 保険期間
    const ps = date(inp.pStart), pe = date(inp.pEnd);
    if(!acc || !ps || !pe) add('保険期間','warn','保険期間と事故発生日を入力してください。');
    else if(acc < ps || acc >= pe) add('保険期間','ng','事故発生日が保険期間の外です。');
    else add('保険期間','ok','保険期間中の事故です。');

    // 3 保険の対象
    const obj = inp.object, objName = obj==='building'?'建物':'家財';
    const insured = obj==='building' ? !!inp.tBuilding : !!inp.tContents;
    add('保険の対象', insured?'ok':'ng', insured ? `${objName}は保険の対象に含まれています。` : `${objName}は保険の対象に含まれていません。`);

    // 4 免責事由
    if(inp.exIntent) add('免責事由','ng','故意・重大な過失・法令違反による損害は支払対象外です。');
    else if(inp.exWar) add('免責事由','ng','戦争・内乱・核燃料物質等による損害は支払対象外です。');
    else if(inp.exWear || c==='wear') add('免責事由','ng','経年劣化・さび・腐食・虫食い等による損害は、偶然な事故ではないため支払対象外です。');
    else add('免責事由','ok','該当する免責事由はありません。');

    // 5 補償範囲
    let isQuake = c==='quake';
    const quakeFire = (c==='fire'||c==='explosion') && S.qQuakeFire==='y';
    if(quakeFire) isQuake = true;

    if(c==='wear'){
      add('補償範囲','na','経年劣化はどの補償にも当たりません。');
    }else if(isQuake){
      if(inp.cQuake) add('補償範囲','ok', quakeFire ? '地震等による火災は火災保険では免責ですが、地震保険で補償されます。' : '地震保険が付帯されています。');
      else add('補償範囲','ng', quakeFire
        ? '地震・噴火・津波による火災は火災保険では免責で、地震保険も付帯されていません。半焼以上であれば地震火災費用保険金（保険金額の5%程度）が支払われる場合があります。'
        : '地震・噴火・津波による損害は火災保険では補償されず、地震保険も付帯されていません。');
    }else{
      const on = !!inp[cause.cov];
      add('補償範囲', on?'ok':'ng', on ? `「${cause.name}」の補償が付帯されています。` : `「${cause.name}」の補償が付帯されていません。`);
    }

    // 6 原因別の支払基準
    const crit = (s,d)=>add('支払基準',s,d);
    const yn = id => S[id] || '';
    if(c==='fire'||c==='explosion'){ if(yn('qQuakeFire')==='') crit('warn','地震等との因果関係が未確認です。地震後の火災は消防の出火原因調査を確認します。'); else if(yn('qQuakeFire')==='n') crit('ok','地震等によらない火災・破裂爆発です。'); }
    if(c==='wind'){ if(yn('qWindExt')==='y') crit('ok','風・雹・雪による外部の破損が確認できます。');
      else if(yn('qWindExt')==='n') crit('ng','建物外部に破損がない吹込み・雨漏りは、風災の対象外です（経年による雨漏りとして扱われます）。');
      else crit('warn','外部の破損の有無を現地調査で確認する必要があります。'); }
    if(c==='flood'){ const v=yn('qFlood'); if(v==='none') crit('ng','床上浸水・地盤面から45cm超・損害30%以上のいずれにも当たらず、水災の支払基準を満たしません。');
      else if(v) crit('ok','水災の支払基準を満たしています（'+({floor:'床上浸水','45':'地盤面から45cm超の浸水','30':'損害30%以上'})[v]+'）。');
      else crit('warn','浸水の高さ・損害割合を確認する必要があります。'); }
    if(c==='water'){ if(yn('qWaterSelf')==='y') crit('ng','給排水設備そのものの修理費は水濡れ補償の対象外です。水が漏れて生じた床・壁・家財の損害が対象です。');
      else if(yn('qWaterSelf')==='n') crit('ok','漏水によって生じた建物・家財の損害です。');
      else crit('warn','損害が設備自体か、漏水による周囲の損害かを確認する必要があります。'); }
    if(c==='impact'){ if(yn('qImpactCar')==='y') crit('ng','契約者・被保険者が運転する車両による衝突は、多くの約款で対象外です（自動車保険で対応）。');
      else if(yn('qImpactCar')==='n') crit('ok','第三者の車両・飛来物などによる損害です。');
      else crit('warn','衝突した物・車両の運転者を確認する必要があります。'); }
    if(c==='theft'){ if(yn('qPolice')==='y') crit('ok','警察への被害届が提出済みです。');
      else if(yn('qPolice')==='n') crit('warn','警察への被害届が必要です。届出がないと支払われません。');
      else crit('warn','被害届の提出状況を確認する必要があります。'); }
    if(c==='breakage'){ if(yn('qCosmetic')==='y') crit('ng','機能に支障のない外観上の損傷は、破損・汚損補償の対象外です。');
      else if(yn('qCosmetic')==='n') crit('ok','機能に支障のある破損・汚損です。');
      else crit('warn','機能への支障の有無を確認する必要があります。'); }
    if(isQuake && inp.cQuake){ const g=yn('qQuakeGrade'); if(g==='none') crit('ng','一部損の基準に満たないため、地震保険は支払われません。');
      else if(g) crit('ok','損害区分は'+QUAKE_RATE[g][1].split(' ')[0]+'の見込みです。');
      else crit('warn','損害区分（全損〜一部損）の認定が必要です。'); }

    // 7 自己負担額と支払額
    const loss = num(inp.loss), ded = num(inp.deduct), sum = num(inp.sumIns);
    let pay = null, calc = '';
    if(isQuake){
      const g = yn('qQuakeGrade'), qs = num(inp.quakeSum);
      if(inp.cQuake && g && g!=='none'){
        pay = qs*QUAKE_RATE[g][0]; calc = `地震保険金額 ${man(qs)} × ${QUAKE_RATE[g][1]}`;
        add('支払額の算定', qs>0?'ok':'warn', qs>0 ? '地震保険は損害区分に応じた定率で支払われ、免責金額はありません。' : '地震保険金額を入力してください。');
      }else add('支払額の算定','na','支払額は算定しません。');
    }else if(c==='wear'){
      add('支払額の算定','na','支払額は算定しません。');
    }else if(loss<=0){
      add('支払額の算定','warn','損害額を入力してください。');
    }else if(c==='wind' && inp.windMode==='franchise'){
      if(loss<20){ add('支払額の算定','ng','損害額が20万円未満のため、風災の支払条件（20万円以上）を満たしません。'); pay=0; }
      else { pay=Math.min(loss, sum||loss); calc=`損害額 ${man(loss)}（20万円以上のため全額）`; add('支払額の算定','ok','損害額が20万円以上のため、損害額の全額が対象です。'); }
    }else if(loss<=ded){
      add('支払額の算定','ng',`損害額 ${man(loss)} が免責金額 ${man(ded)} 以下のため、支払額は0円です。`); pay=0;
    }else{
      pay = loss-ded; calc = `損害額 ${man(loss)} − 免責金額 ${man(ded)}`;
      if(sum>0 && pay>sum){ pay=sum; calc+=`（保険金額 ${man(sum)} が上限）`; }
      add('支払額の算定','ok','免責金額を差し引いた額が支払対象です。');
    }

    const hasNg = checks.some(x=>x.s==='ng'), hasWarn = checks.some(x=>x.s==='warn');
    const verdict = hasNg ? 'ng' : hasWarn ? 'warn' : 'ok';
    return {verdict, checks, pay, calc, isQuake};
  }

  // 架空の事例（請求日は画面側で「今日」を入れる）
  const BASE = {pStart:'2025-04-01',pEnd:'2030-04-01',tBuilding:true,tContents:true,cWind:true,cFlood:false,cWater:true,cImpact:true,cRiot:true,cTheft:true,cBreak:false,cQuake:false,
    sumIns:2000,deduct:5,windMode:'deduct',quakeSum:1000,exIntent:false,exWear:false,exWar:false};
  const SAMPLES = [
    {name:'台風で屋根瓦が飛散', v:{accDate:'2026-09-20',object:'building',cause:'wind',loss:45}, s:{qWindExt:'y'}},
    {name:'古い屋根からの雨漏り', v:{accDate:'2026-10-02',object:'building',cause:'wind',loss:30,exWear:true}, s:{qWindExt:'n'}},
    {name:'豪雨で床下浸水', v:{accDate:'2026-07-10',object:'building',cause:'flood',loss:80,cFlood:true}, s:{qFlood:'none'}},
    {name:'子どもがテレビを倒した', v:{accDate:'2026-10-15',object:'contents',cause:'breakage',loss:12}, s:{qCosmetic:'n'}},
    {name:'空き巣被害', v:{accDate:'2026-10-28',object:'contents',cause:'theft',loss:25}, s:{qPolice:''}},
    {name:'地震で外壁にひび', v:{accDate:'2026-08-03',object:'building',cause:'quake',loss:120,cQuake:true}, s:{qQuakeGrade:'partial'}}
  ];

  const api = {CAUSES, SUBQ, QUAKE_RATE, BASE, SAMPLES, judge, man};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FireJudge = api;
})(typeof window !== 'undefined' ? window : globalThis);
