// 受入基準（docs/spec.md の 5.）のうち、判定の計算に関する項目のテスト
// 実行方法: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { judge, explain, BASE, SAMPLES, makeLogEntry, correction, summarize, toCSV, LOG_COLUMNS } = require('../js/judge.js');

// 請求日を固定して、いつ実行しても同じ結果になるようにする
const CLAIM_DATE = '2026-11-05';

function sampleInput(name, override = {}) {
  const sm = SAMPLES.find(s => s.name === name);
  assert.ok(sm, `事例「${name}」が見つかりません`);
  return { input: Object.assign({}, BASE, { claimDate: CLAIM_DATE }, sm.v, override), sub: sm.s };
}
function runSample(name, override = {}) {
  const { input, sub } = sampleInput(name, override);
  return judge(input, sub);
}
function explainSample(name, override = {}) {
  const { input, sub } = sampleInput(name, override);
  return explain(input, sub);
}
const status = (r, title) => r.checks.find(c => c.t === title)?.s;

test('台風で屋根瓦が飛散 → 有責、支払見込額 40万円', () => {
  const r = runSample('台風で屋根瓦が飛散');
  assert.equal(r.verdict, 'ok');
  assert.equal(r.pay, 40);
});

test('古い屋根からの雨漏り → 無責（免責事由・支払基準が不適合）', () => {
  const r = runSample('古い屋根からの雨漏り');
  assert.equal(r.verdict, 'ng');
  assert.equal(status(r, '免責事由'), 'ng');
  assert.equal(status(r, '支払基準'), 'ng');
});

test('豪雨で床下浸水 → 無責（支払基準が不適合）', () => {
  const r = runSample('豪雨で床下浸水');
  assert.equal(r.verdict, 'ng');
  assert.equal(status(r, '支払基準'), 'ng');
});

test('子どもがテレビを倒した → 有責、支払見込額 7万円', () => {
  const r = runSample('子どもがテレビを倒した');
  assert.equal(r.verdict, 'ok');
  assert.equal(r.pay, 7);
});

test('空き巣被害 → 要確認', () => {
  const r = runSample('空き巣被害');
  assert.equal(r.verdict, 'warn');
});

test('地震で外壁にひび → 無責（火災保険では補償されない）', () => {
  const r = runSample('地震で外壁にひび');
  assert.equal(r.verdict, 'ng');
  assert.equal(status(r, '補償範囲'), 'ng');
  assert.equal(r.pay, null);
});

test('地震が原因の火災 → 無責、地震火災費用保険金の案内が入る', () => {
  const { input } = sampleInput('台風で屋根瓦が飛散', { cause: 'fire' });
  const r = judge(input, { qQuakeFire: 'y' });
  assert.equal(r.verdict, 'ng');
  const cov = r.checks.find(c => c.t === '補償範囲');
  assert.equal(cov.s, 'ng');
  assert.match(cov.d, /地震火災費用保険金/);
});

test('事故発生日が保険期間の外 → 無責（保険期間が不適合）', () => {
  const r = runSample('台風で屋根瓦が飛散', { accDate: '2024-12-01' });
  assert.equal(r.verdict, 'ng');
  assert.equal(status(r, '保険期間'), 'ng');
});

// ---- お客様向けの説明文 ----

test('説明文（有責）: 「お支払い対象となる見込み」が入り、金額は入らない', () => {
  for (const name of ['台風で屋根瓦が飛散', '子どもがテレビを倒した']) {
    const ex = explainSample(name);
    assert.equal(ex.missing, false);
    assert.match(ex.text, /お支払い対象となる見込みです/);
    assert.doesNotMatch(ex.text, /万円/, `${name} の説明文に金額が入っています`);
  }
});

test('説明文（無責）: 不適合になった理由が入る', () => {
  const ex = explainSample('古い屋根からの雨漏り');
  assert.match(ex.text, /お支払い対象とならない見込みです/);
  assert.match(ex.text, /経年劣化/);
  assert.match(ex.text, /吹き込みや雨漏り/);
});

test('説明文（要確認）: 確認が必要な点が入る', () => {
  const ex = explainSample('空き巣被害');
  assert.match(ex.text, /確認したうえで/);
  assert.match(ex.text, /警察への被害届/);
});

test('説明文: 事故の日付と、最終判断は保険会社であることが入る', () => {
  const ex = explainSample('豪雨で床下浸水');
  assert.match(ex.text, /2026年7月10日/);
  assert.match(ex.text, /保険会社による損害調査の結果/);
});

test('説明文: 入力が不足しているときは作らない', () => {
  const ex = explainSample('台風で屋根瓦が飛散', { accDate: '' });
  assert.equal(ex.missing, true);
  assert.equal(ex.text, '');
  const ex2 = explainSample('台風で屋根瓦が飛散', { loss: 0 });
  assert.equal(ex2.missing, true);
});

test('説明文（地震）: 火災保険では補償されないことと、地震保険の別途案内が入る', () => {
  const ex = explainSample('地震で外壁にひび');
  assert.match(ex.text, /お支払い対象とならない見込みです/);
  assert.match(ex.text, /火災保険では補償されません/);
  assert.match(ex.text, /地震保険について別途ご案内/);
});

// ---- 利用ログ ----

const NOW = new Date(2026, 10, 5, 14, 30); // 2026-11-05 14:30（ローカル時刻）
function logOf(name, final = '') {
  const { input, sub } = sampleInput(name);
  return Object.assign(makeLogEntry(input, judge(input, sub), NOW), { final });
}

test('記録1行: 決めた項目だけが入り、個人情報の欄がない', () => {
  const e = logOf('台風で屋根瓦が飛散');
  assert.deepEqual(Object.keys(e).sort(),
    ['accDate', 'cause', 'final', 'id', 'object', 'pay', 'recordedAt', 'verdict'].sort());
  assert.equal(e.recordedAt, '2026-11-05 14:30');
  assert.equal(e.accDate, '2026-09-20');
  assert.equal(e.cause, '風災・雹災・雪災');
  assert.equal(e.object, '建物');
  assert.equal(e.verdict, '有責');
  assert.equal(e.pay, 40);
  assert.equal(e.final, '');
});

test('記録1行: 無責のときは支払見込額を入れない', () => {
  assert.equal(logOf('豪雨で床下浸水').pay, null);
});

test('案内の訂正: 有責↔無責の食い違いだけ「あり」、要確認は「対象外」', () => {
  assert.equal(correction(logOf('台風で屋根瓦が飛散', '無責')), 'あり');
  assert.equal(correction(logOf('豪雨で床下浸水', '有責')), 'あり');
  assert.equal(correction(logOf('台風で屋根瓦が飛散', '有責')), 'なし');
  assert.equal(correction(logOf('空き巣被害', '無責')), '対象外');
  assert.equal(correction(logOf('台風で屋根瓦が飛散', '')), '未入力');
});

test('集計: 記録件数・最終判断入力済み・訂正件数', () => {
  const s = summarize([
    logOf('台風で屋根瓦が飛散', '無責'),   // 訂正あり
    logOf('豪雨で床下浸水', '無責'),       // なし
    logOf('空き巣被害', '有責'),           // 対象外
    logOf('子どもがテレビを倒した', ''),   // 未入力
  ]);
  assert.deepEqual(s, { total: 4, withFinal: 3, corrections: 1 });
});

test('CSV: BOM付き・見出し行・カンマを含む値が崩れない', () => {
  const e1 = logOf('台風で屋根瓦が飛散', '無責');
  const e2 = Object.assign(logOf('豪雨で床下浸水'), { cause: '水災,テスト"引用"' });
  const csv = toCSV([e1, e2]);
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], LOG_COLUMNS.join(','));
  assert.equal(lines[1], '2026-11-05 14:30,2026-09-20,風災・雹災・雪災,建物,有責,40,無責,あり');
  assert.equal(lines[2], '2026-11-05 14:30,2026-07-10,"水災,テスト""引用""",建物,無責,,未入力,未入力');
});
