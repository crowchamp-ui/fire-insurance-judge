// 受入基準（docs/spec.md の 5.）のうち、判定の計算に関する項目のテスト
// 実行方法: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { judge, BASE, SAMPLES } = require('../js/judge.js');

// 請求日を固定して、いつ実行しても同じ結果になるようにする
const CLAIM_DATE = '2026-11-05';

function runSample(name, override = {}) {
  const sm = SAMPLES.find(s => s.name === name);
  assert.ok(sm, `事例「${name}」が見つかりません`);
  const input = Object.assign({}, BASE, { claimDate: CLAIM_DATE }, sm.v, override);
  return judge(input, sm.s);
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

test('空き巣被害 → 要確認', () => {
  const r = runSample('空き巣被害');
  assert.equal(r.verdict, 'warn');
});

test('地震で外壁にひび → 有責、支払見込額 50万円', () => {
  const r = runSample('地震で外壁にひび');
  assert.equal(r.verdict, 'ok');
  assert.equal(r.pay, 50);
});

test('事故発生日が保険期間の外 → 無責（保険期間が不適合）', () => {
  const r = runSample('台風で屋根瓦が飛散', { accDate: '2024-12-01' });
  assert.equal(r.verdict, 'ng');
  assert.equal(status(r, '保険期間'), 'ng');
});
