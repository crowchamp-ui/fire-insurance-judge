// 受入基準（docs/spec.md の 5.）のうち、判定の計算に関する項目のテスト
// 実行方法: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { judge, explain, BASE, SAMPLES } = require('../js/judge.js');

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
